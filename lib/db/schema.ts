import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  boolean,
  jsonb,
  real,
  integer,
} from "drizzle-orm/pg-core";

// Enums
export const planEnum = pgEnum("plan", ["free", "starter", "pro", "agency"]);
export const roleEnum = pgEnum("role", ["owner", "admin", "editor", "viewer"]);
export const providerEnum = pgEnum("provider", ["email", "google"]);
export const platformEnum = pgEnum("platform", [
  "twitter",
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "youtube",
  "pinterest",
  "reddit",
  "bluesky",
  "threads",
  "googlebusiness",
  "telegram",
  "snapchat",
]);
export const postStatusEnum = pgEnum("post_status", [
  "draft",
  "scheduled",
  "published",
  "failed",
  "cancelled",
]);
export const resultStatusEnum = pgEnum("result_status", [
  "success",
  "failed",
  "pending",
]);
export const teamRoleEnum = pgEnum("team_role", ["user", "manager", "admin"]);

// Ideation & Content Intelligence Enums
export const ideaStatusEnum = pgEnum("idea_status", [
  "submitted",
  "shortlisted",
  "commissioned",
  "rejected",
]);
export const ideaSourceEnum = pgEnum("idea_source", [
  "manual",
  "rss",
  "email",
  "api",
  "internal",
]);
export const contentTypeEnum = pgEnum("content_type", [
  "article",
  "video",
  "graphic",
  "thread",
  "newsletter",
  "podcast",
  "other",
]);
export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "in_production",
  "review",
  "approved",
  "published",
]);
export const taskStatusEnum = pgEnum("task_status", [
  "todo",
  "in_progress",
  "review",
  "done",
]);
export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);
export const assetTypeEnum = pgEnum("asset_type", [
  "image",
  "video",
  "document",
  "link",
]);
export const promoDraftStatusEnum = pgEnum("promo_draft_status", [
  "draft",
  "approved",
  "published",
]);

// Customer & Contract Enums
export const customerRoleEnum = pgEnum("customer_role", [
  "viewer",
  "editor",
  "manager",
]);
export const customerStatusEnum = pgEnum("customer_status", [
  "active",
  "inactive",
  "archived",
]);
export const contractStatusEnum = pgEnum("contract_status", [
  "draft",
  "active",
  "completed",
  "expired",
]);
export const cuCategoryEnum = pgEnum("cu_category", [
  "blogs",
  "video",
  "animation",
  "visuals",
  "social",
  "other",
]);

// Tables
export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  plan: planEnum("plan").default("free").notNull(),
  lateApiKey: text("late_api_key"),
  aiModel: text("ai_model").default("claude-sonnet-4-20250514"),
  aiContextConfig: jsonb("ai_context_config")
    .default({ contracts: true, contentPipeline: true, socialPresence: true })
    .$type<{ contracts: boolean; contentPipeline: boolean; socialPresence: boolean }>(),
  aiCuDescription: text("ai_cu_description"),
  aiMaxTokens: integer("ai_max_tokens").default(4096),
  aiDebugMode: boolean("ai_debug_mode").default(false),
  aiFormatDescriptions: jsonb("ai_format_descriptions").$type<Record<string, string>>(),
  aiTypeInstructions: jsonb("ai_type_instructions").$type<Record<string, string>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").unique().notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  hashedPassword: text("hashed_password"),
  provider: providerEnum("provider").default("email").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  role: roleEnum("role").default("viewer").notNull(),
  invitedAt: timestamp("invited_at").defaultNow().notNull(),
  joinedAt: timestamp("joined_at"),
});

export const profiles = pgTable("profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  lateProfileId: text("late_profile_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const socialAccounts = pgTable("social_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id")
    .references(() => profiles.id)
    .notNull(),
  lateAccountId: text("late_account_id").notNull(),
  platform: platformEnum("platform").notNull(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  isActive: boolean("is_active").default(true).notNull(),
  connectedAt: timestamp("connected_at").defaultNow().notNull(),
});

export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  latePostId: text("late_post_id"),
  content: text("content").notNull(),
  platformOverrides: jsonb("platform_overrides"),
  mediaUrls: text("media_urls").array(),
  status: postStatusEnum("status").default("draft").notNull(),
  scheduledFor: timestamp("scheduled_for"),
  timezone: text("timezone").default("UTC").notNull(),
  publishedAt: timestamp("published_at"),
  targetAccounts: jsonb("target_accounts"),
  createdBy: uuid("created_by")
    .references(() => users.id)
    .notNull(),
  approvedBy: uuid("approved_by"),
  notes: text("notes"),
  labels: text("labels").array(),
  contentObjectId: uuid("content_object_id"),
  customerId: uuid("customer_id").references(() => customers.id),
  standalone: boolean("standalone").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const postResults = pgTable("post_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id")
    .references(() => posts.id)
    .notNull(),
  platform: text("platform").notNull(),
  status: resultStatusEnum("status").default("pending").notNull(),
  platformPostId: text("platform_post_id"),
  errorMessage: text("error_message"),
  publishedAt: timestamp("published_at"),
});

export const labels = pgTable("labels", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
});

// Teams
export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const teamMembers = pgTable("team_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  role: teamRoleEnum("role").default("user").notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const teamAccounts = pgTable("team_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  lateAccountId: text("late_account_id").notNull(),
  platform: text("platform").notNull(),
  displayName: text("display_name").notNull(),
  username: text("username"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const activityLog = pgTable("activity_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// Customers & Contracts
// ============================================================

export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  logoUrl: text("logo_url"),
  website: text("website"),
  primaryContactName: text("primary_contact_name"),
  primaryContactEmail: text("primary_contact_email"),
  industry: text("industry"),
  notes: text("notes"),
  status: customerStatusEnum("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const contracts = pgTable("contracts", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .references(() => customers.id, { onDelete: "cascade" })
    .notNull(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  name: text("name").notNull(),
  totalContentUnits: real("total_content_units").notNull(),
  usedContentUnits: real("used_content_units").default(0).notNull(),
  rolloverUnits: real("rollover_units").default(0).notNull(),
  monthlyFee: real("monthly_fee"),
  status: contractStatusEnum("status").default("draft").notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  renewalDate: timestamp("renewal_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const customerMembers = pgTable("customer_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .references(() => customers.id, { onDelete: "cascade" })
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  role: customerRoleEnum("role").default("viewer").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const customerAccounts = pgTable("customer_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .references(() => customers.id, { onDelete: "cascade" })
    .notNull(),
  lateAccountId: text("late_account_id").notNull(),
  platform: text("platform").notNull(),
  displayName: text("display_name").notNull(),
  username: text("username"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const contentUnitDefinitions = pgTable("content_unit_definitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  category: cuCategoryEnum("category").notNull(),
  formatName: text("format_name").notNull(),
  description: text("description"),
  defaultContentUnits: real("default_content_units").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============================================================
// Ideation & Content Intelligence Layer
// ============================================================

// Ideas — content concepts before commissioning
export const ideas = pgTable("ideas", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  title: text("title").notNull(),
  description: text("description"),
  sourceType: ideaSourceEnum("source_type").default("manual").notNull(),
  sourceMetadata: jsonb("source_metadata"),
  topicTags: text("topic_tags").array(),
  strategicTags: text("strategic_tags").array(),
  eventTags: text("event_tags").array(),
  imageUrl: text("image_url"),
  predictedEngagementScore: real("predicted_engagement_score"),
  authorityScore: real("authority_score"),
  status: ideaStatusEnum("status").default("submitted").notNull(),
  customerId: uuid("customer_id").references(() => customers.id),
  createdBy: uuid("created_by")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Content Objects — structured content pieces linked to ideas
export const contentObjects = pgTable("content_objects", {
  id: uuid("id").defaultRandom().primaryKey(),
  ideaId: uuid("idea_id").references(() => ideas.id),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  contentType: contentTypeEnum("content_type").default("article").notNull(),
  workingTitle: text("working_title").notNull(),
  finalTitle: text("final_title"),
  body: text("body"),
  externalDocUrl: text("external_doc_url"),
  socialCopyDocUrl: text("social_copy_doc_url"),
  status: contentStatusEnum("status").default("draft").notNull(),
  assignedWriterId: uuid("assigned_writer_id").references(() => users.id),
  assignedEditorId: uuid("assigned_editor_id").references(() => users.id),
  assignedProducerId: uuid("assigned_producer_id").references(() => users.id),
  formatTags: text("format_tags").array(),
  campaignTags: text("campaign_tags").array(),
  evergreenFlag: boolean("evergreen_flag").default(false).notNull(),
  customerId: uuid("customer_id").references(() => customers.id),
  contractId: uuid("contract_id").references(() => contracts.id),
  contentUnits: real("content_units"),
  createdBy: uuid("created_by")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  publishedAt: timestamp("published_at"),
});

// Template Role Enum
export const templateRoleEnum = pgEnum("template_role", [
  "writer",
  "editor",
  "producer",
  "designer",
  "reviewer",
  "other",
]);

// Task Templates — configurable production steps per content type
export const taskTemplates = pgTable("task_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  contentType: contentTypeEnum("content_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  defaultRole: templateRoleEnum("default_role").default("other").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Production Tasks — task management for content production
export const productionTasks = pgTable("production_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  contentObjectId: uuid("content_object_id")
    .references(() => contentObjects.id, { onDelete: "cascade" })
    .notNull(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  title: text("title").notNull(),
  description: text("description"),
  assignedTo: uuid("assigned_to").references(() => users.id),
  status: taskStatusEnum("status").default("todo").notNull(),
  priority: taskPriorityEnum("priority").default("medium").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  templateId: uuid("template_id").references(() => taskTemplates.id),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  completedBy: uuid("completed_by").references(() => users.id),
  hoursPlanned: real("hours_planned"),
  hoursSpent: real("hours_spent"),
  aiUsed: boolean("ai_used").default(false).notNull(),
  aiDetails: text("ai_details"),
  notes: text("notes"),
  createdBy: uuid("created_by")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Content Assets — file/link attachments for ideas and content objects
export const contentAssets = pgTable("content_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityType: text("entity_type").notNull(), // 'idea' | 'content_object'
  entityId: uuid("entity_id").notNull(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  assetType: assetTypeEnum("asset_type").default("document").notNull(),
  fileSize: integer("file_size"),
  uploadedBy: uuid("uploaded_by")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Content Performance — aggregated engagement per content object
export const contentPerformance = pgTable("content_performance", {
  id: uuid("id").defaultRandom().primaryKey(),
  contentObjectId: uuid("content_object_id")
    .references(() => contentObjects.id, { onDelete: "cascade" })
    .unique()
    .notNull(),
  totalImpressions: integer("total_impressions").default(0).notNull(),
  totalClicks: integer("total_clicks").default(0).notNull(),
  totalReactions: integer("total_reactions").default(0).notNull(),
  totalComments: integer("total_comments").default(0).notNull(),
  totalShares: integer("total_shares").default(0).notNull(),
  totalWatchTime: integer("total_watch_time").default(0).notNull(),
  averageEngagementScore: real("average_engagement_score").default(0).notNull(),
  engagementVelocity: real("engagement_velocity").default(0).notNull(),
  platformBreakdown: jsonb("platform_breakdown"),
  replayCount: integer("replay_count").default(0).notNull(),
  replayPerformanceDelta: real("replay_performance_delta"),
  performancePercentile: real("performance_percentile"),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
});

// Workspace Performance Model — per-workspace learning model
export const workspacePerformanceModel = pgTable(
  "workspace_performance_model",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .unique()
      .notNull(),
    topicPerformanceMap: jsonb("topic_performance_map"),
    formatPerformanceMap: jsonb("format_performance_map"),
    bestPostingWindows: jsonb("best_posting_windows"),
    averageEngagementBaseline: real("average_engagement_baseline")
      .default(0)
      .notNull(),
    highPerformanceThreshold: real("high_performance_threshold")
      .default(0)
      .notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  }
);

// Profile Links — link-in-bio page builder
export const profileLinks = pgTable("profile_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  icon: text("icon"),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Promo Drafts — AI-generated social promotional drafts per content object
export const promoDrafts = pgTable("promo_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  contentObjectId: uuid("content_object_id")
    .references(() => contentObjects.id, { onDelete: "cascade" })
    .notNull(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  platform: platformEnum("platform").notNull(),
  content: text("content").notNull(),
  mediaUrls: jsonb("media_urls"),
  status: promoDraftStatusEnum("status").default("draft").notNull(),
  generatedByAi: boolean("generated_by_ai").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============================================================
// AI Conversations & Messages
// ============================================================

export const aiVisibilityEnum = pgEnum("ai_visibility", ["private", "team"]);
export const aiMessageRoleEnum = pgEnum("ai_message_role", [
  "user",
  "assistant",
  "system",
]);

export const aiConversations = pgTable("ai_conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" })
    .notNull(),
  createdBy: integer("created_by").notNull(),
  title: text("title").default("New Conversation").notNull(),
  visibility: text("visibility").default("private").notNull(),
  contentObjectId: integer("content_object_id"),
  customerId: integer("customer_id"),
  model: text("model").default("claude-sonnet-4-20250514").notNull(),
  isIncognito: boolean("is_incognito").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const aiMessages = pgTable("ai_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .references(() => aiConversations.id, { onDelete: "cascade" })
    .notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  attachments: text("attachments"),
  model: text("model"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── AI Conversation Shares ──
// Allows sharing private conversations with specific workspace members.
// "view" = read-only, "collaborate" = can send messages.
export const aiConversationShares = pgTable("ai_conversation_shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .references(() => aiConversations.id, { onDelete: "cascade" })
    .notNull(),
  userId: integer("user_id").notNull(), // Supabase id_user of recipient
  permission: text("permission").default("view").notNull(), // 'view' | 'collaborate'
  sharedBy: integer("shared_by").notNull(), // Supabase id_user of owner who shared
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── AI Roles ──
// Configurable AI personas/roles that modify the system prompt.
// Auto-seeded with defaults on first access per workspace.
export const aiRoles = pgTable("ai_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  instructions: text("instructions").notNull(),
  icon: text("icon").default("🤖").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── User Area Access ──
// Stores per-workspace per-user area access flags.
// Separate from Supabase workspace_members to keep in Drizzle/Neon.
export const userAccess = pgTable("user_access", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  userId: integer("user_id").notNull(),
  accessEngine: boolean("access_engine").default(true).notNull(),
  accessEngineGpt: boolean("access_enginegpt").default(true).notNull(),
  accessOperations: boolean("access_operations").default(false).notNull(),
  accessAdmin: boolean("access_admin").default(false).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── AI Memories ──
// Stores user/team memories extracted from conversations for personalisation.
// Private memories (userId set) are only injected for that user.
// Team memories (userId null, scope='team') are shared across the workspace.
export const aiMemories = pgTable("ai_memories", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" })
    .notNull(),
  userId: integer("user_id"), // null = team memory, set = user-private
  scope: text("scope").default("private").notNull(), // 'private' | 'team'
  category: text("category").default("fact").notNull(), // preference | fact | instruction | style | client_insight
  content: text("content").notNull(),
  sourceConversationId: uuid("source_conversation_id")
    .references(() => aiConversations.id, { onDelete: "set null" }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── AI Usage Tracking ──
// Logs every AI API call with token counts and cost for dashboard analytics.
export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" })
    .notNull(),
  userId: integer("user_id").notNull(),
  model: text("model").notNull(),
  source: text("source").notNull(), // 'enginegpt' | 'engine' | 'api'
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  costTenths: integer("cost_tenths").default(0).notNull(), // cost in tenths of cents
  conversationId: uuid("conversation_id").references(() => aiConversations.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
