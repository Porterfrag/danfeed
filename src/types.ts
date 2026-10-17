export type PostKind = 'photo' | 'video' | 'gif' | 'ugoira' | 'embed'

export interface Variant {
  type: string
  url: string
  width: number
  height: number
  file_ext: string
}

export interface MediaAsset {
  duration?: number | null
  variants?: Variant[]
}

export interface DanbooruPost {
  id: number
  file_ext: string
  file_size?: number | null
  file_url?: string | null
  large_file_url?: string | null
  preview_file_url?: string | null
  image_width?: number | null
  image_height?: number | null
  rating?: string | null
  score?: number | null
  tag_string?: string | null
  /**
   * Category-specific tag lists. Note `tag_string` already contains all of these,
   * so anything shown from here must be filtered out of the generic tag row.
   */
  tag_string_artist?: string | null
  tag_string_character?: string | null
  tag_string_copyright?: string | null
  tag_string_meta?: string | null
  media_asset?: MediaAsset | null
}

/** Normalised item the feed renders. Both Danbooru posts and custom URLs become this. */
export interface MediaItem {
  key: string
  kind: PostKind
  src: string
  poster?: string
  width: number
  height: number
  bytes?: number
  rating?: string
  score?: number
  tags: string[]
  /**
   * Browsable entity tags, in canonical searchable form (`corn_kuten`,
   * `narita_taishin_(umamusume)`). Kept separate from `tags` because they are also
   * *contained* in `tags` — the UI strips them from the generic `#tag` chips so they
   * are not shown twice.
   */
  artists: string[]
  characters: string[]
  copyrights: string[]
  /**
   * Flags rather than content — `highres`, `absurdres`, `commentary_request`, `bad_id`.
   * Kept only so the slide row can leave them out; `highres` alone covers 8.3M posts, and
   * `bad_id` means the post's ID is wrong, so neither is worth browsing.
   */
  metaTags: string[]
  postId?: number
  sourceUrl?: string
  origin: 'danbooru' | 'custom'
  title?: string
}
