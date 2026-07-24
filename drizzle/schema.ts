import { pgTable, foreignKey, uuid, text, timestamp, unique, boolean, jsonb, integer, real, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const assetType = pgEnum("asset_type", ['image', 'video', 'document', 'link'])
export const contentStatus = pgEnum("content_status", ['draft', 'in_production', 'review', 'approved', 'published'])
export const contentType = pgEnum("content_type", ['article', 'video', 'graphic', 'thread', 'newsletter', 'podcast', 'other'])
export const ideaSource = pgEnum("idea_source", ['manual', 'rss', 'email', 'api', 'internal'])
export const ideaStatus = pgEnum("idea_status", ['submitted', 'shortlisted', 'commissioned', 'rejected'])
export const plan = pgEnum("plan", ['free', 'starter', 'pro', 'agency'])
export const platform = pgEnum("platform", ['twitter', 'instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'pinterest', 'reddit', 'bluesky', 'threads', 'googlebusiness', 'telegram', 'snapchat'])
export const postStatus = pgEnum("post_status", ['draft', 'scheduled', 'published', 'failed', 'cancelled'])
export const promoDraftStatus = pgEnum("promo_draft_status", ['draft', 'approved', 'published'])
export const provider = pgEnum("provider", ['email', 'google'])
export const resultStatus = pgEnum("result_status", ['success', 'failed', 'pending'])
export const role = pgEnum("role", ['owner', 'admin', 'editor', 'viewer'])
export const taskPriority = pgEnum("task_priority", ['low', 'medium', 'high', 'urgent'])
export const taskStatus = pgEnum("task_status", ['todo', 'in_progress', 'review', 'done'])
export const teamRole = pgEnum("team_role", ['user', 'manager', 'admin'])
export const templateRole = pgEnum("template_role", ['writer', 'editor', 'producer', 'designer', 'reviewer', 'other'])


export const labels = pgTable("labels", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	name: text().notNull(),
	color: text().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "labels_workspace_id_workspaces_id_fk"
		}),
]);

export const workspaceMembers = pgTable("workspace_members", {
	workspaceId: uuid("workspace_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: role().default('viewer').notNull(),
	invitedAt: timestamp("invited_at", { mode: 'string' }).defaultNow().notNull(),
	joinedAt: timestamp("joined_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "workspace_members_workspace_id_workspaces_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "workspace_members_user_id_users_id_fk"
		}),
]);

export const teamAccounts = pgTable("team_accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	teamId: uuid("team_id").notNull(),
	lateAccountId: text("late_account_id").notNull(),
	platform: text().notNull(),
	displayName: text("display_name").notNull(),
	username: text(),
	avatarUrl: text("avatar_url"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.teamId],
			foreignColumns: [teams.id],
			name: "team_accounts_team_id_teams_id_fk"
		}).onDelete("cascade"),
]);

export const workspaces = pgTable("workspaces", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	plan: plan().default('free').notNull(),
	lateApiKey: text("late_api_key"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("workspaces_slug_unique").on(table.slug),
]);

export const profiles = pgTable("profiles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	lateProfileId: text("late_profile_id").notNull(),
	name: text().notNull(),
	description: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "profiles_workspace_id_workspaces_id_fk"
		}),
]);

export const teamMembers = pgTable("team_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	teamId: uuid("team_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: teamRole().default('user').notNull(),
	joinedAt: timestamp("joined_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.teamId],
			foreignColumns: [teams.id],
			name: "team_members_team_id_teams_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "team_members_user_id_users_id_fk"
		}),
]);

export const teams = pgTable("teams", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	name: text().notNull(),
	description: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "teams_workspace_id_workspaces_id_fk"
		}),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text().notNull(),
	name: text().notNull(),
	avatarUrl: text("avatar_url"),
	hashedPassword: text("hashed_password"),
	provider: provider().default('email').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("users_email_unique").on(table.email),
]);

export const socialAccounts = pgTable("social_accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	profileId: uuid("profile_id").notNull(),
	lateAccountId: text("late_account_id").notNull(),
	platform: platform().notNull(),
	username: text().notNull(),
	displayName: text("display_name").notNull(),
	avatarUrl: text("avatar_url"),
	isActive: boolean("is_active").default(true).notNull(),
	connectedAt: timestamp("connected_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.profileId],
			foreignColumns: [profiles.id],
			name: "social_accounts_profile_id_profiles_id_fk"
		}),
]);

export const postResults = pgTable("post_results", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").notNull(),
	platform: text().notNull(),
	status: resultStatus().default('pending').notNull(),
	platformPostId: text("platform_post_id"),
	errorMessage: text("error_message"),
	publishedAt: timestamp("published_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "post_results_post_id_posts_id_fk"
		}),
]);

export const posts = pgTable("posts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	latePostId: text("late_post_id"),
	content: text().notNull(),
	platformOverrides: jsonb("platform_overrides"),
	mediaUrls: text("media_urls").array(),
	status: postStatus().default('draft').notNull(),
	scheduledFor: timestamp("scheduled_for", { mode: 'string' }),
	timezone: text().default('UTC').notNull(),
	publishedAt: timestamp("published_at", { mode: 'string' }),
	targetAccounts: jsonb("target_accounts"),
	createdBy: uuid("created_by").notNull(),
	approvedBy: uuid("approved_by"),
	notes: text(),
	labels: text().array(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	contentObjectId: uuid("content_object_id"),
	standalone: boolean().default(true).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "posts_workspace_id_workspaces_id_fk"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "posts_created_by_users_id_fk"
		}),
]);

export const profileLinks = pgTable("profile_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	title: text().notNull(),
	url: text().notNull(),
	description: text(),
	icon: text(),
	sortOrder: integer("sort_order").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "profile_links_workspace_id_workspaces_id_fk"
		}),
]);

export const taskTemplates = pgTable("task_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	contentType: contentType("content_type").notNull(),
	title: text().notNull(),
	description: text(),
	defaultRole: templateRole("default_role").default('other').notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "task_templates_workspace_id_workspaces_id_fk"
		}),
]);

export const contentAssets = pgTable("content_assets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	entityType: text("entity_type").notNull(),
	entityId: uuid("entity_id").notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	name: text().notNull(),
	url: text().notNull(),
	assetType: assetType("asset_type").default('document').notNull(),
	fileSize: integer("file_size"),
	uploadedBy: uuid("uploaded_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "content_assets_workspace_id_workspaces_id_fk"
		}),
	foreignKey({
			columns: [table.uploadedBy],
			foreignColumns: [users.id],
			name: "content_assets_uploaded_by_users_id_fk"
		}),
]);

export const activityLog = pgTable("activity_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	userId: uuid("user_id").notNull(),
	action: text().notNull(),
	entityType: text("entity_type").notNull(),
	entityId: text("entity_id").notNull(),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "activity_log_workspace_id_workspaces_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "activity_log_user_id_users_id_fk"
		}),
]);

export const workspacePerformanceModel = pgTable("workspace_performance_model", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	topicPerformanceMap: jsonb("topic_performance_map"),
	formatPerformanceMap: jsonb("format_performance_map"),
	bestPostingWindows: jsonb("best_posting_windows"),
	averageEngagementBaseline: real("average_engagement_baseline").default(0).notNull(),
	highPerformanceThreshold: real("high_performance_threshold").default(0).notNull(),
	computedAt: timestamp("computed_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "workspace_performance_model_workspace_id_workspaces_id_fk"
		}),
	unique("workspace_performance_model_workspace_id_unique").on(table.workspaceId),
]);

export const promoDrafts = pgTable("promo_drafts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	contentObjectId: uuid("content_object_id").notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	platform: platform().notNull(),
	content: text().notNull(),
	mediaUrls: jsonb("media_urls"),
	status: promoDraftStatus().default('draft').notNull(),
	generatedByAi: boolean("generated_by_ai").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.contentObjectId],
			foreignColumns: [contentObjects.id],
			name: "promo_drafts_content_object_id_content_objects_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "promo_drafts_workspace_id_workspaces_id_fk"
		}),
]);

export const contentObjects = pgTable("content_objects", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ideaId: uuid("idea_id"),
	workspaceId: uuid("workspace_id").notNull(),
	contentType: contentType("content_type").default('article').notNull(),
	workingTitle: text("working_title").notNull(),
	finalTitle: text("final_title"),
	body: text(),
	externalDocUrl: text("external_doc_url"),
	socialCopyDocUrl: text("social_copy_doc_url"),
	status: contentStatus().default('draft').notNull(),
	assignedWriterId: uuid("assigned_writer_id"),
	assignedEditorId: uuid("assigned_editor_id"),
	assignedProducerId: uuid("assigned_producer_id"),
	formatTags: text("format_tags").array(),
	campaignTags: text("campaign_tags").array(),
	evergreenFlag: boolean("evergreen_flag").default(false).notNull(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	publishedAt: timestamp("published_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.ideaId],
			foreignColumns: [ideas.id],
			name: "content_objects_idea_id_ideas_id_fk"
		}),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "content_objects_workspace_id_workspaces_id_fk"
		}),
	foreignKey({
			columns: [table.assignedWriterId],
			foreignColumns: [users.id],
			name: "content_objects_assigned_writer_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.assignedEditorId],
			foreignColumns: [users.id],
			name: "content_objects_assigned_editor_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.assignedProducerId],
			foreignColumns: [users.id],
			name: "content_objects_assigned_producer_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "content_objects_created_by_users_id_fk"
		}),
]);

export const contentPerformance = pgTable("content_performance", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	contentObjectId: uuid("content_object_id").notNull(),
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
	computedAt: timestamp("computed_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.contentObjectId],
			foreignColumns: [contentObjects.id],
			name: "content_performance_content_object_id_content_objects_id_fk"
		}).onDelete("cascade"),
	unique("content_performance_content_object_id_unique").on(table.contentObjectId),
]);

export const productionTasks = pgTable("production_tasks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	contentObjectId: uuid("content_object_id").notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	title: text().notNull(),
	description: text(),
	assignedTo: uuid("assigned_to"),
	status: taskStatus().default('todo').notNull(),
	priority: taskPriority().default('medium').notNull(),
	dueDate: timestamp("due_date", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	templateId: uuid("template_id"),
	completedBy: uuid("completed_by"),
	hoursPlanned: real("hours_planned"),
	hoursSpent: real("hours_spent"),
	aiUsed: boolean("ai_used").default(false).notNull(),
	aiDetails: text("ai_details"),
	notes: text(),
}, (table) => [
	foreignKey({
			columns: [table.contentObjectId],
			foreignColumns: [contentObjects.id],
			name: "production_tasks_content_object_id_content_objects_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "production_tasks_workspace_id_workspaces_id_fk"
		}),
	foreignKey({
			columns: [table.assignedTo],
			foreignColumns: [users.id],
			name: "production_tasks_assigned_to_users_id_fk"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "production_tasks_created_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [taskTemplates.id],
			name: "production_tasks_template_id_task_templates_id_fk"
		}),
	foreignKey({
			columns: [table.completedBy],
			foreignColumns: [users.id],
			name: "production_tasks_completed_by_users_id_fk"
		}),
]);

export const ideas = pgTable("ideas", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	title: text().notNull(),
	description: text(),
	sourceType: ideaSource("source_type").default('manual').notNull(),
	sourceMetadata: jsonb("source_metadata"),
	topicTags: text("topic_tags").array(),
	strategicTags: text("strategic_tags").array(),
	predictedEngagementScore: real("predicted_engagement_score"),
	authorityScore: real("authority_score"),
	status: ideaStatus().default('submitted').notNull(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "ideas_workspace_id_workspaces_id_fk"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "ideas_created_by_users_id_fk"
		}),
]);
