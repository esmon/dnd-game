-- Character avatars: public-read storage bucket. Uploads go through
-- the /api/character/[id]/avatar route, which authenticates with the
-- service role key and validates ownership server-side, so we don't
-- need INSERT / UPDATE / DELETE policies on storage.objects for the
-- end-user role. The bucket just needs to be readable so the battle
-- UI can render avatars without an authenticated fetch.
insert into storage.buckets (id, name, public)
values ('character-avatars', 'character-avatars', true)
on conflict (id) do nothing;

-- Public SELECT on this bucket only. Other buckets keep their own
-- defaults.
create policy "Public read character-avatars"
on storage.objects
for select
using (bucket_id = 'character-avatars');
