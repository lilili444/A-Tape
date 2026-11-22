// Supabase 连接设置。
// 这两项本来就是给网页用的，可以公开；数据安全靠数据库里的权限规则（RLS）保证。
// ⚠️ 千万不要在这里或仓库里任何地方放 Secret key（sb_secret_…）或数据库密码。
window.JOURNAL_CONFIG = {
  supabaseUrl: 'https://mnhssaygujirlmvxenyx.supabase.co',
  supabaseKey: 'sb_publishable_LmESUJt6-3B8adqEAzhcSw_zjWL-R9m',
};
