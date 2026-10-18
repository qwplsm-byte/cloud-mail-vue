const KvConst = {
	AUTH_INFO: 'auth-uid:',
	SETTING: 'setting:',
	SEND_DAY_COUNT: 'send_day_count:',
	ANALYSIS_ECHARTS: 'analysis_echarts:',
	PUBLIC_KEY: "public_key:",
	//通行密钥注册/登录时的 challenge, 短时有效且一次性使用
	PASSKEY_CHALLENGE: 'passkey_challenge:',
	//每日要务晨报: 按用户+日期缓存, 一天内只生成一次
	AI_BRIEFING: 'ai_briefing:'
}

export default KvConst;
