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
  postId?: number
  sourceUrl?: string
  origin: 'danbooru' | 'custom'
  title?: string
}
