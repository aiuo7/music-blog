-- ================================================================
--   Supabase 设置脚本 — 在 Supabase Dashboard > SQL Editor 中运行
--   项目: nolkjvpcnqkduqpbqiay
--   说明：新建独立的 blog_settings 表，绕开 profiles 外键问题
-- ================================================================

-- 1. 删除旧表（如果存在且为空，重新创建确保干净）
--    如果有数据不想丢失，注释掉下面这行
-- DROP TABLE IF EXISTS public.blog_settings CASCADE;

-- 2. 创建独立的设置表（不依赖 users 表，无外键约束）
CREATE TABLE IF NOT EXISTS public.blog_settings (
  id TEXT PRIMARY KEY,
  music_playlist JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 强制关闭 RLS（个人博客无需行级安全）
ALTER TABLE public.blog_settings DISABLE ROW LEVEL SECURITY;

-- 4. 删除可能存在的旧策略（清理残留）
DROP POLICY IF EXISTS "blog_settings_select" ON public.blog_settings;
DROP POLICY IF EXISTS "blog_settings_insert" ON public.blog_settings;
DROP POLICY IF EXISTS "blog_settings_update" ON public.blog_settings;
DROP POLICY IF EXISTS "blog_settings_delete" ON public.blog_settings;

-- 5. 重新启用 RLS 并创建允许匿名的策略（双保险：即使 RLS 被意外开启也能访问）
ALTER TABLE public.blog_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blog_settings_select" ON public.blog_settings FOR SELECT USING (true);
CREATE POLICY "blog_settings_insert" ON public.blog_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "blog_settings_update" ON public.blog_settings FOR UPDATE USING (true);
CREATE POLICY "blog_settings_delete" ON public.blog_settings FOR DELETE USING (true);

-- 6. 授予匿名和认证角色完整权限
GRANT ALL ON public.blog_settings TO anon;
GRANT ALL ON public.blog_settings TO authenticated;

-- 7. 插入固定的共享设置记录（所有人共用这一条）
INSERT INTO public.blog_settings (id, music_playlist)
VALUES ('my_blog_settings', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ================================================================
--   Storage 桶设置（如需上传头像/背景到云端）
-- ================================================================
-- 创建桶（如不存在）
-- INSERT INTO storage.buckets (id, name, public) VALUES ('avatar', 'avatar', true) ON CONFLICT DO NOTHING;
-- INSERT INTO storage.buckets (id, name, public) VALUES ('background', 'background', true) ON CONFLICT DO NOTHING;
-- INSERT INTO storage.buckets (id, name, public) VALUES ('audio', 'audio', true) ON CONFLICT DO NOTHING;
-- 允许匿名上传
-- CREATE POLICY "允许匿名上传" ON storage.objects FOR INSERT WITH CHECK (true);
-- CREATE POLICY "允许匿名读取" ON storage.objects FOR SELECT USING (true);
