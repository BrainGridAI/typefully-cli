export const DEFAULT_BASE_URL = "https://api.typefully.com/v2";

export const PLATFORMS = ["x", "linkedin", "threads", "bluesky", "mastodon", "substack"] as const;
export type Platform = (typeof PLATFORMS)[number];

export type DraftStatus = "draft" | "scheduled" | "published" | "publishing" | "failed";

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface Paginated<T> {
  results: T[];
  count?: number;
  limit?: number;
  offset?: number;
  next?: string | null;
  previous?: string | null;
}

// ---------------------------------------------------------------------------
// Me / social sets
// ---------------------------------------------------------------------------

export interface Me {
  id: number;
  name: string;
  email: string;
  profile_image_url?: string | null;
  signup_date?: string;
  api_key_label?: string | null;
}

export interface TeamRef {
  id?: number;
  name: string;
}

export interface PlatformAccount {
  platform: Platform;
  username: string;
  name: string;
  profile_image_url?: string | null;
  profile_url?: string | null;
}

export interface PublishingQuota {
  used: number;
  remaining: number;
  resets_at: string;
}

export interface SocialSet {
  id: number;
  username: string;
  name: string;
  profile_image_url?: string | null;
  team?: TeamRef | null;
  /** Only present on the single-set GET. */
  platforms?: Partial<Record<Platform, PlatformAccount | null>>;
  publishing_quota?: PublishingQuota;
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export interface PostInput {
  text: string;
  media_ids?: string[];
  quote_post_url?: string | null;
  hide_link_preview?: boolean;
}

export interface PlatformPostsInput {
  enabled: boolean;
  posts?: PostInput[];
  settings?: {
    reply_to_url?: string;
    community_id?: string;
  } | null;
}

export type PlatformsInput = Partial<Record<Platform, PlatformPostsInput>>;

export type PublishAt = "now" | "next-free-slot" | string;

export interface CreateDraftRequest {
  platforms: PlatformsInput;
  publish_at?: PublishAt;
  draft_title?: string;
  tags?: string[];
  share?: boolean;
  scratchpad_text?: string;
}

export type UpdateDraftRequest = Partial<CreateDraftRequest> & { publish_at?: PublishAt | null };

/** Item as returned from `GET /drafts` (summary) and `GET /drafts/:id` (full). */
export interface Draft {
  id: number;
  social_set_id: number;
  status: DraftStatus | string;
  publish_state?: string | null;
  preview?: string | null;
  draft_title?: string | null;
  scheduled_date?: string | null;
  published_at?: string | null;
  created_at: string;
  updated_at?: string;
  tags: string[];
  share_url?: string | null;
  private_url?: string | null;
  scratchpad_text?: string | null;
  platforms?: PlatformsInput & Record<string, unknown>;
  x_post_enabled?: boolean;
  linkedin_post_enabled?: boolean;
  threads_post_enabled?: boolean;
  bluesky_post_enabled?: boolean;
  mastodon_post_enabled?: boolean;
  substack_post_enabled?: boolean;
  x_published_url?: string | null;
  linkedin_published_url?: string | null;
  threads_published_url?: string | null;
  bluesky_published_url?: string | null;
  mastodon_published_url?: string | null;
  substack_published_url?: string | null;
  [key: string]: unknown;
}

export interface ListDraftsRequest {
  status?: string;
  tag?: string;
  order_by?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export interface MediaUploadInit {
  media_id: string;
  upload_url: string;
}

export interface MediaStatus {
  media_id?: string;
  id?: string;
  status: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export interface Tag {
  slug: string;
  name: string;
  created_at?: string;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface QueueItem {
  at: string;
  kind: string;
  draft: Draft | null;
}

export interface QueueDay {
  date: string;
  items: QueueItem[];
}

export interface QueueView {
  social_set_id: number;
  start_date: string;
  end_date: string;
  days: QueueDay[];
}

export interface QueueRule {
  h: number;
  m: number;
  days: string[];
}

export interface QueueSchedule {
  social_set_id: number;
  timezone: string;
  rules: QueueRule[];
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface PostEngagement {
  total?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  quotes?: number | null;
  saves?: number | null;
  profile_clicks?: number | null;
  link_clicks?: number | null;
}

export interface PostAnalytics {
  platform: string;
  post_id: string;
  draft_id: number | null;
  created_at: string;
  preview_text?: string | null;
  url?: string | null;
  metrics: {
    impressions?: number | null;
    engagement?: PostEngagement;
  };
}

export interface ListPostAnalyticsRequest {
  start_date: string;
  end_date: string;
  include_replies?: boolean;
  limit?: number;
  offset?: number;
}

export interface FollowersAnalytics {
  platform: string;
  current_followers_count: number;
  data: Array<{ date: string; followers_count: number }>;
}

// ---------------------------------------------------------------------------
// LinkedIn
// ---------------------------------------------------------------------------

export interface LinkedInOrgResolve {
  mention_text?: string;
  [key: string]: unknown;
}
