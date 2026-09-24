const kvObjService = {

	async putObj(c, key, content, metadata) {
		await c.env.kv.put(key, content, { metadata: metadata });
	},

	async deleteObj(c, keys) {

		if (typeof keys === 'string') {
			keys = [keys];
		}

		if (keys.length === 0) {
			return;
		}

		await Promise.all(keys.map( key => c.env.kv.delete(key)));
	},

	async getObj(c, key) {
		const obj = await c.env.kv.getWithMetadata(key, { type: "arrayBuffer"});
		if (!obj.value) {
			return null;
		}

		const buffer = obj.value;
		const headers = {
			'Content-Type': obj.metadata?.contentType || 'application/octet-stream',
			'Content-Disposition': obj.metadata?.contentDisposition || null,
			'Cache-Control': obj.metadata?.cacheControl || null,
			'Accept-Ranges': 'bytes'
		};

		//支持 Range, 视频播放/拖动进度需要
		const range = c.req?.headers?.get?.('range');
		const matched = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());

		if (matched) {
			const total = buffer.byteLength;

			if (matched[1] === '' && matched[2] === '') {
				return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${total}` } });
			}

			let start = matched[1] === '' ? total - Number(matched[2]) : Number(matched[1]);
			let end = matched[1] === '' || matched[2] === '' ? total - 1 : Number(matched[2]);

			start = Math.max(start, 0);
			end = Math.min(end, total - 1);

			if (start > end || start >= total) {
				return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${total}` } });
			}

			return new Response(buffer.slice(start, end + 1), {
				status: 206,
				headers: {
					...headers,
					'Content-Range': `bytes ${start}-${end}/${total}`,
					'Content-Length': `${end - start + 1}`
				}
			});
		}

		return new Response(buffer, { headers });
	},

	async toObjResp(c, key) {

		return await this.getObj(c, key);

	}

};

export default kvObjService;
