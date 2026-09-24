import { relations } from "drizzle-orm/relations";
import { workspaces, labels, workspaceMembers, users, teams, teamAccounts, profiles, teamMembers, socialAccounts, posts, postResults, profileLinks, taskTemplates, contentAssets, activityLog, workspacePerformanceModel, contentObjects, promoDrafts, ideas, contentPerformance, productionTasks } from "./schema";

export const labelsRelations = relations(labels, ({one}) => ({
	workspace: one(workspaces, {
		fields: [labels.workspaceId],
		references: [workspaces.id]
	}),
}));

export const workspacesRelations = relations(workspaces, ({many}) => ({
	labels: many(labels),
	workspaceMembers: many(workspaceMembers),
	profiles: many(profiles),
	teams: many(teams),
	posts: many(posts),
	profileLinks: many(profileLinks),
	taskTemplates: many(taskTemplates),
	contentAssets: many(contentAssets),
	activityLogs: many(activityLog),
	workspacePerformanceModels: many(workspacePerformanceModel),
	promoDrafts: many(promoDrafts),
	contentObjects: many(contentObjects),
	productionTasks: many(productionTasks),
	ideas: many(ideas),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({one}) => ({
	workspace: one(workspaces, {
		fields: [workspaceMembers.workspaceId],
		references: [workspaces.id]
	}),
	user: one(users, {
		fields: [workspaceMembers.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	workspaceMembers: many(workspaceMembers),
	teamMembers: many(teamMembers),
	posts: many(posts),
	contentAssets: many(contentAssets),
	activityLogs: many(activityLog),
	contentObjects_assignedWriterId: many(contentObjects, {
		relationName: "contentObjects_assignedWriterId_users_id"
	}),
	contentObjects_assignedEditorId: many(contentObjects, {
		relationName: "contentObjects_assignedEditorId_users_id"
	}),
	contentObjects_assignedProducerId: many(contentObjects, {
		relationName: "contentObjects_assignedProducerId_users_id"
	}),
	contentObjects_createdBy: many(contentObjects, {
		relationName: "contentObjects_createdBy_users_id"
	}),
	productionTasks_assignedTo: many(productionTasks, {
		relationName: "productionTasks_assignedTo_users_id"
	}),
	productionTasks_createdBy: many(productionTasks, {
		relationName: "productionTasks_createdBy_users_id"
	}),
	productionTasks_completedBy: many(productionTasks, {
		relationName: "productionTasks_completedBy_users_id"
	}),
	ideas: many(ideas),
}));

export const teamAccountsRelations = relations(teamAccounts, ({one}) => ({
	team: one(teams, {
		fields: [teamAccounts.teamId],
		references: [teams.id]
	}),
}));

export const teamsRelations = relations(teams, ({one, many}) => ({
	teamAccounts: many(teamAccounts),
	teamMembers: many(teamMembers),
	workspace: one(workspaces, {
		fields: [teams.workspaceId],
		references: [workspaces.id]
	}),
}));

export const profilesRelations = relations(profiles, ({one, many}) => ({
	workspace: one(workspaces, {
		fields: [profiles.workspaceId],
		references: [workspaces.id]
	}),
	socialAccounts: many(socialAccounts),
}));

export const teamMembersRelations = relations(teamMembers, ({one}) => ({
	team: one(teams, {
		fields: [teamMembers.teamId],
		references: [teams.id]
	}),
	user: one(users, {
		fields: [teamMembers.userId],
		references: [users.id]
	}),
}));

export const socialAccountsRelations = relations(socialAccounts, ({one}) => ({
	profile: one(profiles, {
		fields: [socialAccounts.profileId],
		references: [profiles.id]
	}),
}));

export const postResultsRelations = relations(postResults, ({one}) => ({
	post: one(posts, {
		fields: [postResults.postId],
		references: [posts.id]
	}),
}));

export const postsRelations = relations(posts, ({one, many}) => ({
	postResults: many(postResults),
	workspace: one(workspaces, {
		fields: [posts.workspaceId],
		references: [workspaces.id]
	}),
	user: one(users, {
		fields: [posts.createdBy],
		references: [users.id]
	}),
}));

export const profileLinksRelations = relations(profileLinks, ({one}) => ({
	workspace: one(workspaces, {
		fields: [profileLinks.workspaceId],
		references: [workspaces.id]
	}),
}));

export const taskTemplatesRelations = relations(taskTemplates, ({one, many}) => ({
	workspace: one(workspaces, {
		fields: [taskTemplates.workspaceId],
		references: [workspaces.id]
	}),
	productionTasks: many(productionTasks),
}));

export const contentAssetsRelations = relations(contentAssets, ({one}) => ({
	workspace: one(workspaces, {
		fields: [contentAssets.workspaceId],
		references: [workspaces.id]
	}),
	user: one(users, {
		fields: [contentAssets.uploadedBy],
		references: [users.id]
	}),
}));

export const activityLogRelations = relations(activityLog, ({one}) => ({
	workspace: one(workspaces, {
		fields: [activityLog.workspaceId],
		references: [workspaces.id]
	}),
	user: one(users, {
		fields: [activityLog.userId],
		references: [users.id]
	}),
}));

export const workspacePerformanceModelRelations = relations(workspacePerformanceModel, ({one}) => ({
	workspace: one(workspaces, {
		fields: [workspacePerformanceModel.workspaceId],
		references: [workspaces.id]
	}),
}));

export const promoDraftsRelations = relations(promoDrafts, ({one}) => ({
	contentObject: one(contentObjects, {
		fields: [promoDrafts.contentObjectId],
		references: [contentObjects.id]
	}),
	workspace: one(workspaces, {
		fields: [promoDrafts.workspaceId],
		references: [workspaces.id]
	}),
}));

export const contentObjectsRelations = relations(contentObjects, ({one, many}) => ({
	promoDrafts: many(promoDrafts),
	idea: one(ideas, {
		fields: [contentObjects.ideaId],
		references: [ideas.id]
	}),
	workspace: one(workspaces, {
		fields: [contentObjects.workspaceId],
		references: [workspaces.id]
	}),
	user_assignedWriterId: one(users, {
		fields: [contentObjects.assignedWriterId],
		references: [users.id],
		relationName: "contentObjects_assignedWriterId_users_id"
	}),
	user_assignedEditorId: one(users, {
		fields: [contentObjects.assignedEditorId],
		references: [users.id],
		relationName: "contentObjects_assignedEditorId_users_id"
	}),
	user_assignedProducerId: one(users, {
		fields: [contentObjects.assignedProducerId],
		references: [users.id],
		relationName: "contentObjects_assignedProducerId_users_id"
	}),
	user_createdBy: one(users, {
		fields: [contentObjects.createdBy],
		references: [users.id],
		relationName: "contentObjects_createdBy_users_id"
	}),
	contentPerformances: many(contentPerformance),
	productionTasks: many(productionTasks),
}));

export const ideasRelations = relations(ideas, ({one, many}) => ({
	contentObjects: many(contentObjects),
	workspace: one(workspaces, {
		fields: [ideas.workspaceId],
		references: [workspaces.id]
	}),
	user: one(users, {
		fields: [ideas.createdBy],
		references: [users.id]
	}),
}));

export const contentPerformanceRelations = relations(contentPerformance, ({one}) => ({
	contentObject: one(contentObjects, {
		fields: [contentPerformance.contentObjectId],
		references: [contentObjects.id]
	}),
}));

export const productionTasksRelations = relations(productionTasks, ({one}) => ({
	contentObject: one(contentObjects, {
		fields: [productionTasks.contentObjectId],
		references: [contentObjects.id]
	}),
	workspace: one(workspaces, {
		fields: [productionTasks.workspaceId],
		references: [workspaces.id]
	}),
	user_assignedTo: one(users, {
		fields: [productionTasks.assignedTo],
		references: [users.id],
		relationName: "productionTasks_assignedTo_users_id"
	}),
	user_createdBy: one(users, {
		fields: [productionTasks.createdBy],
		references: [users.id],
		relationName: "productionTasks_createdBy_users_id"
	}),
	taskTemplate: one(taskTemplates, {
		fields: [productionTasks.templateId],
		references: [taskTemplates.id]
	}),
	user_completedBy: one(users, {
		fields: [productionTasks.completedBy],
		references: [users.id],
		relationName: "productionTasks_completedBy_users_id"
	}),
}));