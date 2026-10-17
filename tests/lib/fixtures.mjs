/**
 * Post fixtures in the shape Danbooru's /posts.json returns.
 *
 * Only the suites that care about tag *categories* use the builder. The rating and
 * suggestion-panel suites keep their own minimal posts on purpose: all they need is a post
 * with a plain `tag_string`, and a fixture that says only that is easier to read.
 */

/**
 * `tag_string` deliberately contains every category, exactly as Danbooru returns it, so the
 * general-tag derivation in lib/tagCategories.ts is genuinely exercised. A fixture that omits
 * `meta` gets `tag_string_meta: ''`, which is what the API sends for a post with no meta tags.
 *
 * `width`/`height` are only for the screenshot harness, which prefers a taller image.
 */
export function buildPost(post) {
  const parts = [post.general, post.artists, post.characters, post.copyrights, post.meta]
  return {
    id: post.id,
    rating: post.rating ?? 'g',
    file_ext: 'jpg',
    file_size: 300000,
    image_width: post.width ?? 1200,
    image_height: post.height ?? 1600,
    file_url: `https://cdn.donmai.us/original/aa/bb/${post.id}.jpg`,
    large_file_url: `https://cdn.donmai.us/sample/aa/bb/sample-${post.id}.jpg`,
    preview_file_url: `https://cdn.donmai.us/180x180/aa/bb/${post.id}.jpg`,
    tag_string: parts.filter(Boolean).join(' '),
    tag_string_artist: post.artists ?? '',
    tag_string_character: post.characters ?? '',
    tag_string_copyright: post.copyrights ?? '',
    tag_string_meta: post.meta ?? '',
    is_animated: false,
    media_asset: { id: 1, variants: [] },
  }
}
