-- The first real user's verdict on the guided questions: more steps than the
-- form. So the optional questions (mood, tags, notes) are OFF unless a person
-- turns them on with /more; the bot asks only for what it cannot know.
alter table public.telegram_accounts alter column quick set default true;
update public.telegram_accounts set quick = true;
