export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string
          name: string
          slug: string
          plan: string
          late_api_key: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          plan?: string
          late_api_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          plan?: string
          late_api_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      types_configuration_delete: {
        Row: {
          document_label: string | null
          flag_brief: number | null
          flag_collections: number | null
          flag_document_body: number | null
          flag_document_social: number | null
          group_files: string | null
          id_configuration: number
          id_type: number
          tab_key: string
          tab_label: string | null
          tab_type: string | null
        }
        Insert: {
          document_label?: string | null
          flag_brief?: number | null
          flag_collections?: number | null
          flag_document_body?: number | null
          flag_document_social?: number | null
          group_files?: string | null
          id_configuration: number
          id_type: number
          tab_key: string
          tab_label?: string | null
          tab_type?: string | null
        }
        Update: {
          document_label?: string | null
          flag_brief?: number | null
          flag_collections?: number | null
          flag_document_body?: number | null
          flag_document_social?: number | null
          group_files?: string | null
          id_configuration?: number
          id_type?: number
          tab_key?: string
          tab_label?: string | null
          tab_type?: string | null
        }
        Relationships: []
      }
      tasks_social: {
        Row: {
          date_completed: string | null
          date_created: string | null
          date_deadline: string | null
          date_deleted: string | null
          date_updated: string | null
          id_social: number | null
          id_task: number
          information_notes: string | null
          order_sort: number | null
          type_task: string | null
          units_content: number | null
          user_assignee: number | null
          user_assigner: number | null
          user_completed: number | null
          user_created: number | null
        }
        Insert: {
          date_completed?: string | null
          date_created?: string | null
          date_deadline?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_social?: number | null
          id_task: number
          information_notes?: string | null
          order_sort?: number | null
          type_task?: string | null
          units_content?: number | null
          user_assignee?: number | null
          user_assigner?: number | null
          user_completed?: number | null
          user_created?: number | null
        }
        Update: {
          date_completed?: string | null
          date_created?: string | null
          date_deadline?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_social?: number | null
          id_task?: number
          information_notes?: string | null
          order_sort?: number | null
          type_task?: string | null
          units_content?: number | null
          user_assignee?: number | null
          user_assigner?: number | null
          user_completed?: number | null
          user_created?: number | null
        }
        Relationships: []
      }
      calculator_content: {
        Row: {
          split_video: number | null
          split_visual: number | null
          split_text: number | null
          format: string | null
          name: string | null
          id_type: number | null
          units_content: number | null
          sort_order: number | null
          id: string
        }
        Insert: {
          split_video?: number | null
          split_visual?: number | null
          split_text?: number | null
          format?: string | null
          name?: string | null
          id_type?: number | null
          units_content?: number | null
          sort_order?: number | null
          id?: string
        }
        Update: {
          split_video?: number | null
          split_visual?: number | null
          split_text?: number | null
          format?: string | null
          name?: string | null
          id_type?: number | null
          units_content?: number | null
          sort_order?: number | null
          id?: string
        }
        Relationships: []
      }
      assets_clients: {
        Row: {
          date_created: string | null
          date_deleted: string | null
          date_updated: string | null
          id_asset: number
          id_client: number | null
          id_file: number | null
          information_description: string | null
          name_asset: string | null
          type_asset: string | null
          creation: string | null
        }
        Insert: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_asset: number
          id_client?: number | null
          id_file?: number | null
          information_description?: string | null
          name_asset?: string | null
          type_asset?: string | null
          creation?: string | null
        }
        Update: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_asset?: number
          id_client?: number | null
          id_file?: number | null
          information_description?: string | null
          name_asset?: string | null
          type_asset?: string | null
          creation?: string | null
        }
        Relationships: []
      }
      lookup_social_topics: {
        Row: {
          id_social: number
          id_topic: number
        }
        Insert: {
          id_social: number
          id_topic: number
        }
        Update: {
          id_social?: number
          id_topic?: number
        }
        Relationships: []
      }
      posting_slots: {
        Row: {
          date_created: string | null
          date_deleted: string | null
          date_updated: string | null
          id_authentication: number | null
          id_client: number | null
          id_distribution: number | null
          id_slot: number
          network: string | null
          slot_day: number | null
          slot_time: string | null
        }
        Insert: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_authentication?: number | null
          id_client?: number | null
          id_distribution?: number | null
          id_slot: number
          network?: string | null
          slot_day?: number | null
          slot_time?: string | null
        }
        Update: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_authentication?: number | null
          id_client?: number | null
          id_distribution?: number | null
          id_slot?: number
          network?: string | null
          slot_day?: number | null
          slot_time?: string | null
        }
        Relationships: []
      }
      workspace_members: {
        Row: {
          id: string
          workspace_id: string
          user_id: number
          role: string
          joined_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id: number
          role?: string
          joined_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          user_id?: number
          role?: string
          joined_at?: string
        }
        Relationships: []
      }
      internal_targets: {
        Row: {
          month: string
          target: number | null
        }
        Insert: {
          month: string
          target?: number | null
        }
        Update: {
          month?: string
          target?: number | null
        }
        Relationships: []
      }
      app_labels_campaigns: {
        Row: {
          id_client: number | null
          name_client: string | null
          id_campaign: number | null
          name_campaign: string | null
          date_start: string | null
          date_end: string | null
          information_description: string | null
          link_url: string | null
        }
        Insert: {
          id_client?: number | null
          name_client?: string | null
          id_campaign?: number | null
          name_campaign?: string | null
          date_start?: string | null
          date_end?: string | null
          information_description?: string | null
          link_url?: string | null
        }
        Update: {
          id_client?: number | null
          name_client?: string | null
          id_campaign?: number | null
          name_campaign?: string | null
          date_start?: string | null
          date_end?: string | null
          information_description?: string | null
          link_url?: string | null
        }
        Relationships: []
      }
      lookup_ideas_campaigns: {
        Row: {
          id_idea: number
          id_campaign: number
        }
        Insert: {
          id_idea: number
          id_campaign: number
        }
        Update: {
          id_idea?: number
          id_campaign?: number
        }
        Relationships: []
      }
      labels_campaigns: {
        Row: {
          date_created: string | null
          date_deleted: string | null
          date_end: string | null
          date_start: string | null
          date_updated: string | null
          id_campaign: number
          id_client: number | null
          information_description: string | null
          link_url: string | null
          name_campaign: string | null
        }
        Insert: {
          date_created?: string | null
          date_deleted?: string | null
          date_end?: string | null
          date_start?: string | null
          date_updated?: string | null
          id_campaign: number
          id_client?: number | null
          information_description?: string | null
          link_url?: string | null
          name_campaign?: string | null
        }
        Update: {
          date_created?: string | null
          date_deleted?: string | null
          date_end?: string | null
          date_start?: string | null
          date_updated?: string | null
          id_campaign?: number
          id_client?: number | null
          information_description?: string | null
          link_url?: string | null
          name_campaign?: string | null
        }
        Relationships: []
      }
      app_templates_document: {
        Row: {
          id_template: number | null
          document_type: string | null
          document_target: string | null
          key_template: string | null
          link_url: string | null
          document_reference: string | null
          id_type: number | null
        }
        Insert: {
          id_template?: number | null
          document_type?: string | null
          document_target?: string | null
          key_template?: string | null
          link_url?: string | null
          document_reference?: string | null
          id_type?: number | null
        }
        Update: {
          id_template?: number | null
          document_type?: string | null
          document_target?: string | null
          key_template?: string | null
          link_url?: string | null
          document_reference?: string | null
          id_type?: number | null
        }
        Relationships: []
      }
      posting_distributions: {
        Row: {
          date_created: string | null
          date_expiry_refresh: string | null
          date_expiry_token: string | null
          flag_active: number | null
          flag_default: number | null
          flag_enabled: number | null
          id_authentication: number | null
          id_distribution: number | null
          id_image: number | null
          id_resource: number | null
          information_description: string | null
          information_warning: string | null
          name_authentication: string | null
          name_resource: string | null
          network: string | null
          secret_name: string | null
          secret_version: number | null
          type_distribution: string | null
        }
        Insert: {
          date_created?: string | null
          date_expiry_refresh?: string | null
          date_expiry_token?: string | null
          flag_active?: number | null
          flag_default?: number | null
          flag_enabled?: number | null
          id_authentication?: number | null
          id_distribution?: number | null
          id_image?: number | null
          id_resource?: number | null
          information_description?: string | null
          information_warning?: string | null
          name_authentication?: string | null
          name_resource?: string | null
          network?: string | null
          secret_name?: string | null
          secret_version?: number | null
          type_distribution?: string | null
        }
        Update: {
          date_created?: string | null
          date_expiry_refresh?: string | null
          date_expiry_token?: string | null
          flag_active?: number | null
          flag_default?: number | null
          flag_enabled?: number | null
          id_authentication?: number | null
          id_distribution?: number | null
          id_image?: number | null
          id_resource?: number | null
          information_description?: string | null
          information_warning?: string | null
          name_authentication?: string | null
          name_resource?: string | null
          network?: string | null
          secret_name?: string | null
          secret_version?: number | null
          type_distribution?: string | null
        }
        Relationships: []
      }
      app_assets_ideas: {
        Row: {
          id_idea: number | null
          id_asset: number | null
          date_created: string | null
          information_description: string | null
          name_asset: string | null
          type_asset: string | null
          id_file: number | null
          file_name: string | null
          file_url: string | null
          file_path: string | null
          file_bucket: string | null
        }
        Insert: {
          id_idea?: number | null
          id_asset?: number | null
          date_created?: string | null
          information_description?: string | null
          name_asset?: string | null
          type_asset?: string | null
          id_file?: number | null
          file_name?: string | null
          file_url?: string | null
          file_path?: string | null
          file_bucket?: string | null
        }
        Update: {
          id_idea?: number | null
          id_asset?: number | null
          date_created?: string | null
          information_description?: string | null
          name_asset?: string | null
          type_asset?: string | null
          id_file?: number | null
          file_name?: string | null
          file_url?: string | null
          file_path?: string | null
          file_bucket?: string | null
        }
        Relationships: []
      }
      types_content: {
        Row: {
          flag_active: number | null
          flag_completed: number | null
          id_type: number
          key_type: string | null
          type_content: string | null
        }
        Insert: {
          flag_active?: number | null
          flag_completed?: number | null
          id_type: number
          key_type?: string | null
          type_content?: string | null
        }
        Update: {
          flag_active?: number | null
          flag_completed?: number | null
          id_type?: number
          key_type?: string | null
          type_content?: string | null
        }
        Relationships: []
      }
      social_posts_overview: {
        Row: {
          date_created: string | null
          date_deleted: string | null
          date_post: string | null
          date_published: string | null
          date_scheduled: string | null
          date_updated: string | null
          error_post_key: string | null
          error_post_message: string | null
          flag_metrics: number | null
          flag_post_edited: number | null
          id_airtable: string | null
          id_client: number | null
          id_content: number | null
          id_contract: number | null
          id_distribution: number | null
          id_idea: number | null
          id_network: string | null
          id_post: number | null
          id_social: number | null
          information_response: string | null
          link_post: string | null
          metrics_score: number | null
          name_post: string | null
          network: string | null
          post: string | null
          type_post: string | null
        }
        Insert: {
          date_created?: string | null
          date_deleted?: string | null
          date_post?: string | null
          date_published?: string | null
          date_scheduled?: string | null
          date_updated?: string | null
          error_post_key?: string | null
          error_post_message?: string | null
          flag_metrics?: number | null
          flag_post_edited?: number | null
          id_airtable?: string | null
          id_client?: number | null
          id_content?: number | null
          id_contract?: number | null
          id_distribution?: number | null
          id_idea?: number | null
          id_network?: string | null
          id_post?: number | null
          id_social?: number | null
          information_response?: string | null
          link_post?: string | null
          metrics_score?: number | null
          name_post?: string | null
          network?: string | null
          post?: string | null
          type_post?: string | null
        }
        Update: {
          date_created?: string | null
          date_deleted?: string | null
          date_post?: string | null
          date_published?: string | null
          date_scheduled?: string | null
          date_updated?: string | null
          error_post_key?: string | null
          error_post_message?: string | null
          flag_metrics?: number | null
          flag_post_edited?: number | null
          id_airtable?: string | null
          id_client?: number | null
          id_content?: number | null
          id_contract?: number | null
          id_distribution?: number | null
          id_idea?: number | null
          id_network?: string | null
          id_post?: number | null
          id_social?: number | null
          information_response?: string | null
          link_post?: string | null
          metrics_score?: number | null
          name_post?: string | null
          network?: string | null
          post?: string | null
          type_post?: string | null
        }
        Relationships: []
      }
      social: {
        Row: {
          date_completed: string | null
          date_created: string | null
          date_deadline: string | null
          date_deleted: string | null
          date_evergreen: string | null
          date_spiked: string | null
          date_updated: string | null
          flag_completed: number | null
          flag_evergreen: number | null
          flag_replay: number | null
          flag_spiked: number | null
          flag_tasks: number | null
          id_airtable: string | null
          id_client: number | null
          id_content: number | null
          id_contract: number | null
          id_distribution: number | null
          id_idea: number | null
          id_social: number
          name_social: string | null
          network: string | null
          post: Json | null
          type_post: string | null
          user_completed: number | null
          user_spiked: number | null
        }
        Insert: {
          date_completed?: string | null
          date_created?: string | null
          date_deadline?: string | null
          date_deleted?: string | null
          date_evergreen?: string | null
          date_spiked?: string | null
          date_updated?: string | null
          flag_completed?: number | null
          flag_evergreen?: number | null
          flag_replay?: number | null
          flag_spiked?: number | null
          flag_tasks?: number | null
          id_airtable?: string | null
          id_client?: number | null
          id_content?: number | null
          id_contract?: number | null
          id_distribution?: number | null
          id_idea?: number | null
          id_social: number
          name_social?: string | null
          network?: string | null
          post?: Json | null
          type_post?: string | null
          user_completed?: number | null
          user_spiked?: number | null
        }
        Update: {
          date_completed?: string | null
          date_created?: string | null
          date_deadline?: string | null
          date_deleted?: string | null
          date_evergreen?: string | null
          date_spiked?: string | null
          date_updated?: string | null
          flag_completed?: number | null
          flag_evergreen?: number | null
          flag_replay?: number | null
          flag_spiked?: number | null
          flag_tasks?: number | null
          id_airtable?: string | null
          id_client?: number | null
          id_content?: number | null
          id_contract?: number | null
          id_distribution?: number | null
          id_idea?: number | null
          id_social?: number
          name_social?: string | null
          network?: string | null
          post?: Json | null
          type_post?: string | null
          user_completed?: number | null
          user_spiked?: number | null
        }
        Relationships: []
      }
      app_labels_events: {
        Row: {
          id_client: number | null
          name_client: string | null
          id_event: number | null
          name_event: string | null
          date_start: string | null
          date_end: string | null
          information_description: string | null
          link_url: string | null
        }
        Insert: {
          id_client?: number | null
          name_client?: string | null
          id_event?: number | null
          name_event?: string | null
          date_start?: string | null
          date_end?: string | null
          information_description?: string | null
          link_url?: string | null
        }
        Update: {
          id_client?: number | null
          name_client?: string | null
          id_event?: number | null
          name_event?: string | null
          date_start?: string | null
          date_end?: string | null
          information_description?: string | null
          link_url?: string | null
        }
        Relationships: []
      }
      customer_accounts: {
        Row: {
          id: string
          customer_id: number
          late_account_id: string
          platform: string
          display_name: string
          username: string | null
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          customer_id: number
          late_account_id: string
          platform: string
          display_name: string
          username?: string | null
          avatar_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          customer_id?: number
          late_account_id?: string
          platform?: string
          display_name?: string
          username?: string | null
          avatar_url?: string | null
          created_at?: string
        }
        Relationships: []
      }
      app_tasks_social: {
        Row: {
          id_client: number | null
          name_client: string | null
          id_contract: number | null
          name_contract: string | null
          id_content: number | null
          name_content: string | null
          flag_fast_turnaround: number | null
          date_deadline_publication: string | null
          type_content: string | null
          id_social: number | null
          name_social: string | null
          network: string | null
          type_post: string | null
          flag_spiked: number | null
          id_task: number | null
          date_completed: string | null
          date_created: string | null
          date_deadline: string | null
          information_notes: string | null
          type_task: string | null
          units_content: number | null
          order_sort: number | null
          id_user_assignee: number | null
          name_user_assignee: string | null
          id_user_assigner: number | null
          name_user_assigner: string | null
          id_user_completed: number | null
          name_user_completed: string | null
          id_user_created: number | null
          name_user_created: string | null
          flag_task_current: string | null
        }
        Insert: {
          id_client?: number | null
          name_client?: string | null
          id_contract?: number | null
          name_contract?: string | null
          id_content?: number | null
          name_content?: string | null
          flag_fast_turnaround?: number | null
          date_deadline_publication?: string | null
          type_content?: string | null
          id_social?: number | null
          name_social?: string | null
          network?: string | null
          type_post?: string | null
          flag_spiked?: number | null
          id_task?: number | null
          date_completed?: string | null
          date_created?: string | null
          date_deadline?: string | null
          information_notes?: string | null
          type_task?: string | null
          units_content?: number | null
          order_sort?: number | null
          id_user_assignee?: number | null
          name_user_assignee?: string | null
          id_user_assigner?: number | null
          name_user_assigner?: string | null
          id_user_completed?: number | null
          name_user_completed?: string | null
          id_user_created?: number | null
          name_user_created?: string | null
          flag_task_current?: string | null
        }
        Update: {
          id_client?: number | null
          name_client?: string | null
          id_contract?: number | null
          name_contract?: string | null
          id_content?: number | null
          name_content?: string | null
          flag_fast_turnaround?: number | null
          date_deadline_publication?: string | null
          type_content?: string | null
          id_social?: number | null
          name_social?: string | null
          network?: string | null
          type_post?: string | null
          flag_spiked?: number | null
          id_task?: number | null
          date_completed?: string | null
          date_created?: string | null
          date_deadline?: string | null
          information_notes?: string | null
          type_task?: string | null
          units_content?: number | null
          order_sort?: number | null
          id_user_assignee?: number | null
          name_user_assignee?: string | null
          id_user_assigner?: number | null
          name_user_assigner?: string | null
          id_user_completed?: number | null
          name_user_completed?: string | null
          id_user_created?: number | null
          name_user_created?: string | null
          flag_task_current?: string | null
        }
        Relationships: []
      }
      promo_drafts: {
        Row: {
          id: string
          content_object_id: string
          workspace_id: string
          platform: string
          content: string
          media_urls: Json | null
          status: string
          generated_by_ai: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          content_object_id: string
          workspace_id: string
          platform: string
          content: string
          media_urls?: Json | null
          status?: string
          generated_by_ai?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          content_object_id?: string
          workspace_id?: string
          platform?: string
          content?: string
          media_urls?: Json | null
          status?: string
          generated_by_ai?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      lookup_ideas_events: {
        Row: {
          id_idea: number
          id_event: number
        }
        Insert: {
          id_idea: number
          id_event: number
        }
        Update: {
          id_idea?: number
          id_event?: number
        }
        Relationships: []
      }
      lookup_content_campaigns: {
        Row: {
          id_content: number
          id_campaign: number
        }
        Insert: {
          id_content: number
          id_campaign: number
        }
        Update: {
          id_content?: number
          id_campaign?: number
        }
        Relationships: []
      }
      clients: {
        Row: {
          date_created: string | null
          date_deleted: string | null
          date_updated: string | null
          document_folder: string | null
          document_type: string | null
          etherpad_group_id: string | null
          feature_analytics: number | null
          feature_autopilot: number | null
          feature_autoschedule: number | null
          feature_social: number | null
          file_avatar: number | null
          file_logo: number | null
          file_style_guide: number | null
          id_client: number
          id_feedbly: string | null
          information_description: string | null
          information_guidelines: string | null
          information_industry: string | null
          information_notes: string | null
          information_onboarding: string | null
          information_size: string | null
          information_timezone: string | null
          link_linkedin: string | null
          link_website: string | null
          name_client: string | null
          user_account_manager: number | null
        }
        Insert: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          document_folder?: string | null
          document_type?: string | null
          etherpad_group_id?: string | null
          feature_analytics?: number | null
          feature_autopilot?: number | null
          feature_autoschedule?: number | null
          feature_social?: number | null
          file_avatar?: number | null
          file_logo?: number | null
          file_style_guide?: number | null
          id_client: number
          id_feedbly?: string | null
          information_description?: string | null
          information_guidelines?: string | null
          information_industry?: string | null
          information_notes?: string | null
          information_onboarding?: string | null
          information_size?: string | null
          information_timezone?: string | null
          link_linkedin?: string | null
          link_website?: string | null
          name_client?: string | null
          user_account_manager?: number | null
        }
        Update: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          document_folder?: string | null
          document_type?: string | null
          etherpad_group_id?: string | null
          feature_analytics?: number | null
          feature_autopilot?: number | null
          feature_autoschedule?: number | null
          feature_social?: number | null
          file_avatar?: number | null
          file_logo?: number | null
          file_style_guide?: number | null
          id_client?: number
          id_feedbly?: string | null
          information_description?: string | null
          information_guidelines?: string | null
          information_industry?: string | null
          information_notes?: string | null
          information_onboarding?: string | null
          information_size?: string | null
          information_timezone?: string | null
          link_linkedin?: string | null
          link_website?: string | null
          name_client?: string | null
          user_account_manager?: number | null
        }
        Relationships: []
      }
      lookup_users_content: {
        Row: {
          id_content: number
          id_user: number
        }
        Insert: {
          id_content: number
          id_user: number
        }
        Update: {
          id_content?: number
          id_user?: number
        }
        Relationships: []
      }
      app_media_content: {
        Row: {
          id_revision: number | null
          id_content: number | null
          date_created_revision: string | null
          flag_current: number | null
          information_notes: string | null
          information_comment: string | null
          order_version: number | null
          id_media: number | null
          date_created_media: string | null
          information_caption: string | null
          information_credit: string | null
          information_license: string | null
          link_credit: string | null
          order_sort: number | null
          id_file: number | null
          type_file: string | null
          file_name: string | null
          file_path: string | null
          file_bucket: string | null
        }
        Insert: {
          id_revision?: number | null
          id_content?: number | null
          date_created_revision?: string | null
          flag_current?: number | null
          information_notes?: string | null
          information_comment?: string | null
          order_version?: number | null
          id_media?: number | null
          date_created_media?: string | null
          information_caption?: string | null
          information_credit?: string | null
          information_license?: string | null
          link_credit?: string | null
          order_sort?: number | null
          id_file?: number | null
          type_file?: string | null
          file_name?: string | null
          file_path?: string | null
          file_bucket?: string | null
        }
        Update: {
          id_revision?: number | null
          id_content?: number | null
          date_created_revision?: string | null
          flag_current?: number | null
          information_notes?: string | null
          information_comment?: string | null
          order_version?: number | null
          id_media?: number | null
          date_created_media?: string | null
          information_caption?: string | null
          information_credit?: string | null
          information_license?: string | null
          link_credit?: string | null
          order_sort?: number | null
          id_file?: number | null
          type_file?: string | null
          file_name?: string | null
          file_path?: string | null
          file_bucket?: string | null
        }
        Relationships: []
      }
      app_lookup_users_clients: {
        Row: {
          id_client: number | null
          name_client: string | null
          id_user: number | null
          name_user: string | null
          email_user: string | null
          role_user: string | null
          role_job: string | null
        }
        Insert: {
          id_client?: number | null
          name_client?: string | null
          id_user?: number | null
          name_user?: string | null
          email_user?: string | null
          role_user?: string | null
          role_job?: string | null
        }
        Update: {
          id_client?: number | null
          name_client?: string | null
          id_user?: number | null
          name_user?: string | null
          email_user?: string | null
          role_user?: string | null
          role_job?: string | null
        }
        Relationships: []
      }
      shares_links: {
        Row: {
          id_share: string
          id_content: number | null
          name_content: string | null
          date_created: string
          date_expiry: string | null
          items: Json | null
          order_version: number | null
          id_revision: number | null
        }
        Insert: {
          id_share?: string
          id_content?: number | null
          name_content?: string | null
          date_created?: string
          date_expiry?: string | null
          items?: Json | null
          order_version?: number | null
          id_revision?: number | null
        }
        Update: {
          id_share?: string
          id_content?: number | null
          name_content?: string | null
          date_created?: string
          date_expiry?: string | null
          items?: Json | null
          order_version?: number | null
          id_revision?: number | null
        }
        Relationships: []
      }
      contracts: {
        Row: {
          date_created: string | null
          date_deleted: string | null
          date_end: string | null
          date_start: string | null
          date_updated: string | null
          flag_active: number | null
          flag_default: number | null
          id_client: number | null
          id_contract: number
          id_file: number | null
          information_description: string | null
          information_notes: string | null
          name_contract: string | null
          units_contract: number | null
        }
        Insert: {
          date_created?: string | null
          date_deleted?: string | null
          date_end?: string | null
          date_start?: string | null
          date_updated?: string | null
          flag_active?: number | null
          flag_default?: number | null
          id_client?: number | null
          id_contract: number
          id_file?: number | null
          information_description?: string | null
          information_notes?: string | null
          name_contract?: string | null
          units_contract?: number | null
        }
        Update: {
          date_created?: string | null
          date_deleted?: string | null
          date_end?: string | null
          date_start?: string | null
          date_updated?: string | null
          flag_active?: number | null
          flag_default?: number | null
          id_client?: number | null
          id_contract?: number
          id_file?: number | null
          information_description?: string | null
          information_notes?: string | null
          name_contract?: string | null
          units_contract?: number | null
        }
        Relationships: []
      }
      templates_tasks_social: {
        Row: {
          date_created: string | null
          date_updated: string | null
          flag_account_manager: number | null
          flag_add: number | null
          flag_clone: number | null
          id_template: number
          id_type: number
          information_notes: string | null
          order_sort: number
          type_task: string | null
          units_content: number | null
          units_override: number | null
          user_updated: number | null
        }
        Insert: {
          date_created?: string | null
          date_updated?: string | null
          flag_account_manager?: number | null
          flag_add?: number | null
          flag_clone?: number | null
          id_template: number
          id_type: number
          information_notes?: string | null
          order_sort: number
          type_task?: string | null
          units_content?: number | null
          units_override?: number | null
          user_updated?: number | null
        }
        Update: {
          date_created?: string | null
          date_updated?: string | null
          flag_account_manager?: number | null
          flag_add?: number | null
          flag_clone?: number | null
          id_template?: number
          id_type?: number
          information_notes?: string | null
          order_sort?: number
          type_task?: string | null
          units_content?: number | null
          units_override?: number | null
          user_updated?: number | null
        }
        Relationships: []
      }
      posting_authentication: {
        Row: {
          date_created: string | null
          date_expiry_refresh: string | null
          date_expiry_token: string | null
          flag_default: number | null
          id_authentication: number | null
          id_client: number | null
          link_url: string | null
          name_authentication: string | null
          network: string | null
          secret_name: string | null
          secret_version: number | null
          status: string | null
          user_created: number | null
        }
        Insert: {
          date_created?: string | null
          date_expiry_refresh?: string | null
          date_expiry_token?: string | null
          flag_default?: number | null
          id_authentication?: number | null
          id_client?: number | null
          link_url?: string | null
          name_authentication?: string | null
          network?: string | null
          secret_name?: string | null
          secret_version?: number | null
          status?: string | null
          user_created?: number | null
        }
        Update: {
          date_created?: string | null
          date_expiry_refresh?: string | null
          date_expiry_token?: string | null
          flag_default?: number | null
          id_authentication?: number | null
          id_client?: number | null
          link_url?: string | null
          name_authentication?: string | null
          network?: string | null
          secret_name?: string | null
          secret_version?: number | null
          status?: string | null
          user_created?: number | null
        }
        Relationships: []
      }
      tasks_content: {
        Row: {
          date_completed: string | null
          date_created: string | null
          date_deadline: string | null
          date_deleted: string | null
          date_updated: string | null
          id_content: number | null
          id_task: number
          information_notes: string | null
          order_sort: number | null
          type_task: string | null
          units_content: number | null
          user_assignee: number | null
          user_assigner: number | null
          user_completed: number | null
          user_created: number | null
        }
        Insert: {
          date_completed?: string | null
          date_created?: string | null
          date_deadline?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_content?: number | null
          id_task: number
          information_notes?: string | null
          order_sort?: number | null
          type_task?: string | null
          units_content?: number | null
          user_assignee?: number | null
          user_assigner?: number | null
          user_completed?: number | null
          user_created?: number | null
        }
        Update: {
          date_completed?: string | null
          date_created?: string | null
          date_deadline?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_content?: number | null
          id_task?: number
          information_notes?: string | null
          order_sort?: number | null
          type_task?: string | null
          units_content?: number | null
          user_assignee?: number | null
          user_assigner?: number | null
          user_completed?: number | null
          user_created?: number | null
        }
        Relationships: []
      }
      assets_content: {
        Row: {
          date_created: string | null
          date_deleted: string | null
          date_updated: string | null
          id_asset: number
          id_content: number | null
          id_file: number | null
          information_description: string | null
          name_asset: string | null
          type_asset: string | null
          creation: string | null
        }
        Insert: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_asset: number
          id_content?: number | null
          id_file?: number | null
          information_description?: string | null
          name_asset?: string | null
          type_asset?: string | null
          creation?: string | null
        }
        Update: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_asset?: number
          id_content?: number | null
          id_file?: number | null
          information_description?: string | null
          name_asset?: string | null
          type_asset?: string | null
          creation?: string | null
        }
        Relationships: []
      }
      labels_events: {
        Row: {
          date_created: string | null
          date_deleted: string | null
          date_end: string | null
          date_start: string | null
          date_updated: string | null
          id_client: number | null
          id_event: number
          information_description: string | null
          link_url: string | null
          name_event: string | null
        }
        Insert: {
          date_created?: string | null
          date_deleted?: string | null
          date_end?: string | null
          date_start?: string | null
          date_updated?: string | null
          id_client?: number | null
          id_event: number
          information_description?: string | null
          link_url?: string | null
          name_event?: string | null
        }
        Update: {
          date_created?: string | null
          date_deleted?: string | null
          date_end?: string | null
          date_start?: string | null
          date_updated?: string | null
          id_client?: number | null
          id_event?: number
          information_description?: string | null
          link_url?: string | null
          name_event?: string | null
        }
        Relationships: []
      }
      app_assets_clients: {
        Row: {
          id_client: number | null
          id_asset: number | null
          date_created: string | null
          information_description: string | null
          name_asset: string | null
          type_asset: string | null
          id_file: number | null
          file_name: string | null
          file_url: string | null
          file_path: string | null
          file_bucket: string | null
        }
        Insert: {
          id_client?: number | null
          id_asset?: number | null
          date_created?: string | null
          information_description?: string | null
          name_asset?: string | null
          type_asset?: string | null
          id_file?: number | null
          file_name?: string | null
          file_url?: string | null
          file_path?: string | null
          file_bucket?: string | null
        }
        Update: {
          id_client?: number | null
          id_asset?: number | null
          date_created?: string | null
          information_description?: string | null
          name_asset?: string | null
          type_asset?: string | null
          id_file?: number | null
          file_name?: string | null
          file_url?: string | null
          file_path?: string | null
          file_bucket?: string | null
        }
        Relationships: []
      }
      lookup_social_campaigns: {
        Row: {
          id_social: number
          id_campaign: number
        }
        Insert: {
          id_social: number
          id_campaign: number
        }
        Update: {
          id_social?: number
          id_campaign?: number
        }
        Relationships: []
      }
      posting_late: {
        Row: {
          date_created: string | null
          date_updated: string | null
          date_expiry_refresh: string | null
          date_expiry_token: string | null
          flag_active: number | null
          flag_default: number | null
          id_client: number | null
          id_late_account: number
          id_late_profile: number | null
          name_account: string | null
          network: string | null
          status: string | null
          type_account: string | null
          user_created: number | null
        }
        Insert: {
          date_created?: string | null
          date_updated?: string | null
          date_expiry_refresh?: string | null
          date_expiry_token?: string | null
          flag_active?: number | null
          flag_default?: number | null
          id_client?: number | null
          id_late_account: number
          id_late_profile?: number | null
          name_account?: string | null
          network?: string | null
          status?: string | null
          type_account?: string | null
          user_created?: number | null
        }
        Update: {
          date_created?: string | null
          date_updated?: string | null
          date_expiry_refresh?: string | null
          date_expiry_token?: string | null
          flag_active?: number | null
          flag_default?: number | null
          id_client?: number | null
          id_late_account?: number
          id_late_profile?: number | null
          name_account?: string | null
          network?: string | null
          status?: string | null
          type_account?: string | null
          user_created?: number | null
        }
        Relationships: []
      }
      assets_ideas: {
        Row: {
          date_created: string | null
          date_deleted: string | null
          date_updated: string | null
          id_asset: number
          id_file: number | null
          id_idea: number | null
          information_description: string | null
          name_asset: string | null
          type_asset: string | null
          creation: string | null
        }
        Insert: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_asset: number
          id_file?: number | null
          id_idea?: number | null
          information_description?: string | null
          name_asset?: string | null
          type_asset?: string | null
          creation?: string | null
        }
        Update: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_asset?: number
          id_file?: number | null
          id_idea?: number | null
          information_description?: string | null
          name_asset?: string | null
          type_asset?: string | null
          creation?: string | null
        }
        Relationships: []
      }
      app_users: {
        Row: {
          id_user: number | null
          name_user: string | null
          email_user: string | null
          role_job: string | null
          role_user: string | null
        }
        Insert: {
          id_user?: number | null
          name_user?: string | null
          email_user?: string | null
          role_job?: string | null
          role_user?: string | null
        }
        Update: {
          id_user?: number | null
          name_user?: string | null
          email_user?: string | null
          role_job?: string | null
          role_user?: string | null
        }
        Relationships: []
      }
      templates_tasks_content: {
        Row: {
          date_created: string | null
          date_updated: string | null
          flag_account_manager: number | null
          flag_add: number | null
          flag_clone: number | null
          id_template: number
          id_type: number
          information_notes: string | null
          order_sort: number
          type_task: string | null
          units_content: number | null
          units_override: number | null
          user_updated: number | null
        }
        Insert: {
          date_created?: string | null
          date_updated?: string | null
          flag_account_manager?: number | null
          flag_add?: number | null
          flag_clone?: number | null
          id_template: number
          id_type: number
          information_notes?: string | null
          order_sort: number
          type_task?: string | null
          units_content?: number | null
          units_override?: number | null
          user_updated?: number | null
        }
        Update: {
          date_created?: string | null
          date_updated?: string | null
          flag_account_manager?: number | null
          flag_add?: number | null
          flag_clone?: number | null
          id_template?: number
          id_type?: number
          information_notes?: string | null
          order_sort?: number
          type_task?: string | null
          units_content?: number | null
          units_override?: number | null
          user_updated?: number | null
        }
        Relationships: []
      }
      content_performance: {
        Row: {
          id: string
          content_object_id: string
          total_impressions: number
          total_reactions: number
          total_comments: number
          total_shares: number
          total_clicks: number
          replay_count: number
          last_fetched_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          content_object_id: string
          total_impressions?: number
          total_reactions?: number
          total_comments?: number
          total_shares?: number
          total_clicks?: number
          replay_count?: number
          last_fetched_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          content_object_id?: string
          total_impressions?: number
          total_reactions?: number
          total_comments?: number
          total_shares?: number
          total_clicks?: number
          replay_count?: number
          last_fetched_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_clients: {
        Row: {
          id_client: number | null
          date_created: string | null
          feature_analytics: number | null
          feature_autoschedule: number | null
          feature_social: number | null
          document_type: string | null
          information_description: string | null
          information_guidelines: string | null
          information_industry: string | null
          information_size: string | null
          information_onboarding: string | null
          link_linkedin: string | null
          link_website: string | null
          name_client: string | null
          user_account_manager: number | null
          name_account_manager: string | null
          file_avatar_path: string | null
          file_avatar_bucket: string | null
          file_logo_path: string | null
          file_logo_bucket: string | null
          file_style_guide: number | null
        }
        Insert: {
          id_client?: number | null
          date_created?: string | null
          feature_analytics?: number | null
          feature_autoschedule?: number | null
          feature_social?: number | null
          document_type?: string | null
          information_description?: string | null
          information_guidelines?: string | null
          information_industry?: string | null
          information_size?: string | null
          information_onboarding?: string | null
          link_linkedin?: string | null
          link_website?: string | null
          name_client?: string | null
          user_account_manager?: number | null
          name_account_manager?: string | null
          file_avatar_path?: string | null
          file_avatar_bucket?: string | null
          file_logo_path?: string | null
          file_logo_bucket?: string | null
          file_style_guide?: number | null
        }
        Update: {
          id_client?: number | null
          date_created?: string | null
          feature_analytics?: number | null
          feature_autoschedule?: number | null
          feature_social?: number | null
          document_type?: string | null
          information_description?: string | null
          information_guidelines?: string | null
          information_industry?: string | null
          information_size?: string | null
          information_onboarding?: string | null
          link_linkedin?: string | null
          link_website?: string | null
          name_client?: string | null
          user_account_manager?: number | null
          name_account_manager?: string | null
          file_avatar_path?: string | null
          file_avatar_bucket?: string | null
          file_logo_path?: string | null
          file_logo_bucket?: string | null
          file_style_guide?: number | null
        }
        Relationships: []
      }
      teams: {
        Row: {
          id: string
          workspace_id: string | null
          name: string
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id?: string | null
          name: string
          description?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string | null
          name?: string
          description?: string | null
          created_at?: string
        }
        Relationships: []
      }
      content: {
        Row: {
          date_completed: string | null
          date_created: string | null
          date_deadline_production: string | null
          date_deadline_publication: string | null
          date_deleted: string | null
          date_published: string | null
          date_spiked: string | null
          date_updated: string | null
          document_body: string | null
          document_social: string | null
          document_type: string | null
          etherpad_group_id: string | null
          etherpad_pad_id_body: string | null
          etherpad_pad_id_heading: string | null
          etherpad_pad_id_social: string | null
          etherpad_readonly_id_body: string | null
          etherpad_readonly_id_heading: string | null
          etherpad_readonly_id_social: string | null
          flag_completed: number | null
          flag_fast_turnaround: number | null
          flag_spiked: number | null
          id_airtable: string | null
          id_client: number | null
          id_content: number
          id_contract: number
          id_file: number | null
          id_idea: number | null
          id_type: number | null
          idea_etherpad_group_id: string | null
          idea_etherpad_pad_id: string | null
          idea_etherpad_readonly_id: string | null
          information_audience: string | null
          information_brief: string | null
          information_guidelines: string | null
          information_heading: string | null
          information_length: string | null
          information_notes: string | null
          information_platform: string | null
          link_published: string | null
          name_content: string | null
          type_content: string | null
          units_override: number | null
          user_commissioned: number | null
          user_completed: number | null
          user_content_lead: number | null
          user_spiked: number | null
          creation: string | null
        }
        Insert: {
          date_completed?: string | null
          date_created?: string | null
          date_deadline_production?: string | null
          date_deadline_publication?: string | null
          date_deleted?: string | null
          date_published?: string | null
          date_spiked?: string | null
          date_updated?: string | null
          document_body?: string | null
          document_social?: string | null
          document_type?: string | null
          etherpad_group_id?: string | null
          etherpad_pad_id_body?: string | null
          etherpad_pad_id_heading?: string | null
          etherpad_pad_id_social?: string | null
          etherpad_readonly_id_body?: string | null
          etherpad_readonly_id_heading?: string | null
          etherpad_readonly_id_social?: string | null
          flag_completed?: number | null
          flag_fast_turnaround?: number | null
          flag_spiked?: number | null
          id_airtable?: string | null
          id_client?: number | null
          id_content: number
          id_contract: number
          id_file?: number | null
          id_idea?: number | null
          id_type?: number | null
          idea_etherpad_group_id?: string | null
          idea_etherpad_pad_id?: string | null
          idea_etherpad_readonly_id?: string | null
          information_audience?: string | null
          information_brief?: string | null
          information_guidelines?: string | null
          information_heading?: string | null
          information_length?: string | null
          information_notes?: string | null
          information_platform?: string | null
          link_published?: string | null
          name_content?: string | null
          type_content?: string | null
          units_override?: number | null
          user_commissioned?: number | null
          user_completed?: number | null
          user_content_lead?: number | null
          user_spiked?: number | null
          creation?: string | null
        }
        Update: {
          date_completed?: string | null
          date_created?: string | null
          date_deadline_production?: string | null
          date_deadline_publication?: string | null
          date_deleted?: string | null
          date_published?: string | null
          date_spiked?: string | null
          date_updated?: string | null
          document_body?: string | null
          document_social?: string | null
          document_type?: string | null
          etherpad_group_id?: string | null
          etherpad_pad_id_body?: string | null
          etherpad_pad_id_heading?: string | null
          etherpad_pad_id_social?: string | null
          etherpad_readonly_id_body?: string | null
          etherpad_readonly_id_heading?: string | null
          etherpad_readonly_id_social?: string | null
          flag_completed?: number | null
          flag_fast_turnaround?: number | null
          flag_spiked?: number | null
          id_airtable?: string | null
          id_client?: number | null
          id_content?: number
          id_contract?: number
          id_file?: number | null
          id_idea?: number | null
          id_type?: number | null
          idea_etherpad_group_id?: string | null
          idea_etherpad_pad_id?: string | null
          idea_etherpad_readonly_id?: string | null
          information_audience?: string | null
          information_brief?: string | null
          information_guidelines?: string | null
          information_heading?: string | null
          information_length?: string | null
          information_notes?: string | null
          information_platform?: string | null
          link_published?: string | null
          name_content?: string | null
          type_content?: string | null
          units_override?: number | null
          user_commissioned?: number | null
          user_completed?: number | null
          user_content_lead?: number | null
          user_spiked?: number | null
          creation?: string | null
        }
        Relationships: []
      }
      lookup_users_clients: {
        Row: {
          id_client: number
          id_user: number
        }
        Insert: {
          id_client: number
          id_user: number
        }
        Update: {
          id_client?: number
          id_user?: number
        }
        Relationships: []
      }
      internal_deadline_tasks: {
        Row: {
          id_task: number
          date_start: string | null
          date_end: string | null
        }
        Insert: {
          id_task: number
          date_start?: string | null
          date_end?: string | null
        }
        Update: {
          id_task?: number
          date_start?: string | null
          date_end?: string | null
        }
        Relationships: []
      }
      media_content: {
        Row: {
          date_created: string | null
          date_deleted: string | null
          date_updated: string | null
          id_file: number | null
          id_media: number
          id_revision: number | null
          information_caption: string | null
          information_credit: string | null
          information_license: string | null
          link_credit: string | null
          order_sort: number | null
        }
        Insert: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_file?: number | null
          id_media: number
          id_revision?: number | null
          information_caption?: string | null
          information_credit?: string | null
          information_license?: string | null
          link_credit?: string | null
          order_sort?: number | null
        }
        Update: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_file?: number | null
          id_media?: number
          id_revision?: number | null
          information_caption?: string | null
          information_credit?: string | null
          information_license?: string | null
          link_credit?: string | null
          order_sort?: number | null
        }
        Relationships: []
      }
      templates_etherpad: {
        Row: {
          content: string | null
          key_template: string | null
        }
        Insert: {
          content?: string | null
          key_template?: string | null
        }
        Update: {
          content?: string | null
          key_template?: string | null
        }
        Relationships: []
      }
      app_contracts: {
        Row: {
          id_contract: number | null
          name_contract: string | null
          date_created: string | null
          date_start: string | null
          date_end: string | null
          flag_active: number | null
          flag_default: number | null
          information_description: string | null
          information_notes: string | null
          units_contract: number | null
          id_client: number | null
          name_client: string | null
          user_account_manager: number | null
          name_account_manager: string | null
          units_total: number | null
          units_total_completed: number | null
          units_content: number | null
          units_content_completed: number | null
          units_social: number | null
          units_social_completed: number | null
        }
        Insert: {
          id_contract?: number | null
          name_contract?: string | null
          date_created?: string | null
          date_start?: string | null
          date_end?: string | null
          flag_active?: number | null
          flag_default?: number | null
          information_description?: string | null
          information_notes?: string | null
          units_contract?: number | null
          id_client?: number | null
          name_client?: string | null
          user_account_manager?: number | null
          name_account_manager?: string | null
          units_total?: number | null
          units_total_completed?: number | null
          units_content?: number | null
          units_content_completed?: number | null
          units_social?: number | null
          units_social_completed?: number | null
        }
        Update: {
          id_contract?: number | null
          name_contract?: string | null
          date_created?: string | null
          date_start?: string | null
          date_end?: string | null
          flag_active?: number | null
          flag_default?: number | null
          information_description?: string | null
          information_notes?: string | null
          units_contract?: number | null
          id_client?: number | null
          name_client?: string | null
          user_account_manager?: number | null
          name_account_manager?: string | null
          units_total?: number | null
          units_total_completed?: number | null
          units_content?: number | null
          units_content_completed?: number | null
          units_social?: number | null
          units_social_completed?: number | null
        }
        Relationships: []
      }
      files: {
        Row: {
          date_created: string | null
          date_updated: string | null
          file_name: string | null
          file_path: string | null
          file_url: string | null
          flag_disk: number | null
          flag_private: number | null
          id_file: number
          information_size: number | null
          type_file: string | null
        }
        Insert: {
          date_created?: string | null
          date_updated?: string | null
          file_name?: string | null
          file_path?: string | null
          file_url?: string | null
          flag_disk?: number | null
          flag_private?: number | null
          id_file: number
          information_size?: number | null
          type_file?: string | null
        }
        Update: {
          date_created?: string | null
          date_updated?: string | null
          file_name?: string | null
          file_path?: string | null
          file_url?: string | null
          flag_disk?: number | null
          flag_private?: number | null
          id_file?: number
          information_size?: number | null
          type_file?: string | null
        }
        Relationships: []
      }
      app_media_revisions: {
        Row: {
          id_revision: number | null
          id_content: number | null
          date_created: string | null
          flag_current: number | null
          information_notes: string | null
          information_comment: string | null
          order_version: number | null
        }
        Insert: {
          id_revision?: number | null
          id_content?: number | null
          date_created?: string | null
          flag_current?: number | null
          information_notes?: string | null
          information_comment?: string | null
          order_version?: number | null
        }
        Update: {
          id_revision?: number | null
          id_content?: number | null
          date_created?: string | null
          flag_current?: number | null
          information_notes?: string | null
          information_comment?: string | null
          order_version?: number | null
        }
        Relationships: []
      }
      app_assets_content: {
        Row: {
          id_content: number | null
          id_asset: number | null
          date_created: string | null
          information_description: string | null
          name_asset: string | null
          type_asset: string | null
          id_file: number | null
          file_name: string | null
          file_url: string | null
          file_path: string | null
          file_bucket: string | null
        }
        Insert: {
          id_content?: number | null
          id_asset?: number | null
          date_created?: string | null
          information_description?: string | null
          name_asset?: string | null
          type_asset?: string | null
          id_file?: number | null
          file_name?: string | null
          file_url?: string | null
          file_path?: string | null
          file_bucket?: string | null
        }
        Update: {
          id_content?: number | null
          id_asset?: number | null
          date_created?: string | null
          information_description?: string | null
          name_asset?: string | null
          type_asset?: string | null
          id_file?: number | null
          file_name?: string | null
          file_url?: string | null
          file_path?: string | null
          file_bucket?: string | null
        }
        Relationships: []
      }
      workspace_performance_model: {
        Row: {
          id: string
          workspace_id: string
          topic_performance_map: Json
          format_performance_map: Json
          best_posting_windows: Json
          average_engagement_baseline: number
          high_performance_threshold: number
          computed_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          topic_performance_map: Json
          format_performance_map: Json
          best_posting_windows: Json
          average_engagement_baseline?: number
          high_performance_threshold?: number
          computed_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          topic_performance_map?: Json
          format_performance_map?: Json
          best_posting_windows?: Json
          average_engagement_baseline?: number
          high_performance_threshold?: number
          computed_at?: string
        }
        Relationships: []
      }
      labels_topics: {
        Row: {
          date_created: string | null
          date_deleted: string | null
          date_updated: string | null
          id_client: number | null
          id_topic: number
          name_topic: string | null
        }
        Insert: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_client?: number | null
          id_topic: number
          name_topic?: string | null
        }
        Update: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          id_client?: number | null
          id_topic?: number
          name_topic?: string | null
        }
        Relationships: []
      }
      team_accounts: {
        Row: {
          id: string
          team_id: string
          late_account_id: string
          platform: string
          display_name: string
          username: string | null
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          team_id: string
          late_account_id: string
          platform: string
          display_name: string
          username?: string | null
          avatar_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          late_account_id?: string
          platform?: string
          display_name?: string
          username?: string | null
          avatar_url?: string | null
          created_at?: string
        }
        Relationships: []
      }
      templates_document: {
        Row: {
          document_reference: string | null
          document_type: string
          id_template: number
          key_template: string
          link_url: string | null
        }
        Insert: {
          document_reference?: string | null
          document_type: string
          id_template: number
          key_template: string
          link_url?: string | null
        }
        Update: {
          document_reference?: string | null
          document_type?: string
          id_template?: number
          key_template?: string
          link_url?: string | null
        }
        Relationships: []
      }
      calculator_additions: {
        Row: {
          id_type: number | null
          format: string | null
          addition: string | null
          split_video: number | null
          split_visual: number | null
          split_text: number | null
          units_content: number | null
          sort_order: number | null
          quantity: number | null
          id: string
        }
        Insert: {
          id_type?: number | null
          format?: string | null
          addition?: string | null
          split_video?: number | null
          split_visual?: number | null
          split_text?: number | null
          units_content?: number | null
          sort_order?: number | null
          quantity?: number | null
          id?: string
        }
        Update: {
          id_type?: number | null
          format?: string | null
          addition?: string | null
          split_video?: number | null
          split_visual?: number | null
          split_text?: number | null
          units_content?: number | null
          sort_order?: number | null
          quantity?: number | null
          id?: string
        }
        Relationships: []
      }
      app_content: {
        Row: {
          id_client: number | null
          name_client: string | null
          id_contract: number | null
          name_contract: string | null
          id_idea: number | null
          name_idea: string | null
          id_content: number | null
          name_content: string | null
          id_type: number | null
          type_content: string | null
          date_created: string | null
          date_completed: string | null
          date_spiked: string | null
          date_deadline_production: string | null
          date_deadline_publication: string | null
          information_brief: string | null
          information_length: string | null
          information_guidelines: string | null
          information_audience: string | null
          information_platform: string | null
          flag_fast_turnaround: number | null
          flag_completed: number | null
          flag_spiked: number | null
          document_body: string | null
          document_social: string | null
          document_type: string | null
          id_user_commissioned: number | null
          name_user_commissioned: string | null
          id_user_content_lead: number | null
          name_user_content_lead: string | null
          id_user_completed: number | null
          name_user_completed: string | null
          id_user_spiked: number | null
          name_user_spiked: string | null
          units_content: number | null
          name_topic_array: string[] | null
          id_topic_array: number[] | null
          name_event_array: string[] | null
          id_event_array: number[] | null
          name_campaign_array: string[] | null
          id_campaign_array: number[] | null
        }
        Insert: {
          id_client?: number | null
          name_client?: string | null
          id_contract?: number | null
          name_contract?: string | null
          id_idea?: number | null
          name_idea?: string | null
          id_content?: number | null
          name_content?: string | null
          id_type?: number | null
          type_content?: string | null
          date_created?: string | null
          date_completed?: string | null
          date_spiked?: string | null
          date_deadline_production?: string | null
          date_deadline_publication?: string | null
          information_brief?: string | null
          information_length?: string | null
          information_guidelines?: string | null
          information_audience?: string | null
          information_platform?: string | null
          flag_fast_turnaround?: number | null
          flag_completed?: number | null
          flag_spiked?: number | null
          document_body?: string | null
          document_social?: string | null
          document_type?: string | null
          id_user_commissioned?: number | null
          name_user_commissioned?: string | null
          id_user_content_lead?: number | null
          name_user_content_lead?: string | null
          id_user_completed?: number | null
          name_user_completed?: string | null
          id_user_spiked?: number | null
          name_user_spiked?: string | null
          units_content?: number | null
          name_topic_array?: string[] | null
          id_topic_array?: number[] | null
          name_event_array?: string[] | null
          id_event_array?: number[] | null
          name_campaign_array?: string[] | null
          id_campaign_array?: number[] | null
        }
        Update: {
          id_client?: number | null
          name_client?: string | null
          id_contract?: number | null
          name_contract?: string | null
          id_idea?: number | null
          name_idea?: string | null
          id_content?: number | null
          name_content?: string | null
          id_type?: number | null
          type_content?: string | null
          date_created?: string | null
          date_completed?: string | null
          date_spiked?: string | null
          date_deadline_production?: string | null
          date_deadline_publication?: string | null
          information_brief?: string | null
          information_length?: string | null
          information_guidelines?: string | null
          information_audience?: string | null
          information_platform?: string | null
          flag_fast_turnaround?: number | null
          flag_completed?: number | null
          flag_spiked?: number | null
          document_body?: string | null
          document_social?: string | null
          document_type?: string | null
          id_user_commissioned?: number | null
          name_user_commissioned?: string | null
          id_user_content_lead?: number | null
          name_user_content_lead?: string | null
          id_user_completed?: number | null
          name_user_completed?: string | null
          id_user_spiked?: number | null
          name_user_spiked?: string | null
          units_content?: number | null
          name_topic_array?: string[] | null
          id_topic_array?: number[] | null
          name_event_array?: string[] | null
          id_event_array?: number[] | null
          name_campaign_array?: string[] | null
          id_campaign_array?: number[] | null
        }
        Relationships: []
      }
      ideas: {
        Row: {
          date_commissioned: string | null
          date_created: string | null
          date_deadline: string | null
          date_deleted: string | null
          date_pending: string | null
          date_spiked: string | null
          date_updated: string | null
          flag_commissioned: number | null
          flag_completed: number | null
          flag_favourite: number | null
          flag_pending: number | null
          flag_spiked: number | null
          id_airtable: string | null
          id_client: number | null
          id_contract: number | null
          id_file: number | null
          id_idea: number
          information_brief: string | null
          information_notes: string | null
          link_url: string | null
          name_idea: string | null
          order_custom: number | null
          status: string | null
          user_completed: number | null
          user_pending: number | null
          user_spiked: number | null
          user_submitted: number | null
          creation: string | null
        }
        Insert: {
          date_commissioned?: string | null
          date_created?: string | null
          date_deadline?: string | null
          date_deleted?: string | null
          date_pending?: string | null
          date_spiked?: string | null
          date_updated?: string | null
          flag_commissioned?: number | null
          flag_completed?: number | null
          flag_favourite?: number | null
          flag_pending?: number | null
          flag_spiked?: number | null
          id_airtable?: string | null
          id_client?: number | null
          id_contract?: number | null
          id_file?: number | null
          id_idea: number
          information_brief?: string | null
          information_notes?: string | null
          link_url?: string | null
          name_idea?: string | null
          order_custom?: number | null
          status?: string | null
          user_completed?: number | null
          user_pending?: number | null
          user_spiked?: number | null
          user_submitted?: number | null
          creation?: string | null
        }
        Update: {
          date_commissioned?: string | null
          date_created?: string | null
          date_deadline?: string | null
          date_deleted?: string | null
          date_pending?: string | null
          date_spiked?: string | null
          date_updated?: string | null
          flag_commissioned?: number | null
          flag_completed?: number | null
          flag_favourite?: number | null
          flag_pending?: number | null
          flag_spiked?: number | null
          id_airtable?: string | null
          id_client?: number | null
          id_contract?: number | null
          id_file?: number | null
          id_idea?: number
          information_brief?: string | null
          information_notes?: string | null
          link_url?: string | null
          name_idea?: string | null
          order_custom?: number | null
          status?: string | null
          user_completed?: number | null
          user_pending?: number | null
          user_spiked?: number | null
          user_submitted?: number | null
          creation?: string | null
        }
        Relationships: []
      }
      app_social: {
        Row: {
          id_client: number | null
          name_client: string | null
          id_contract: number | null
          name_contract: string | null
          id_idea: number | null
          name_idea: string | null
          id_content: number | null
          name_content: string | null
          id_social: number | null
          name_social: string | null
          date_created: string | null
          date_completed: string | null
          date_spiked: string | null
          date_deadline: string | null
          date_evergreen: string | null
          flag_evergreen: number | null
          flag_replay: number | null
          flag_tasks: number | null
          network: string | null
          type_post: string | null
          post: Json | null
          id_user_completed: number | null
          name_user_completed: string | null
          id_user_spiked: number | null
          name_user_spiked: string | null
          units_content: number | null
          name_campaign_array: string[] | null
          id_campaign_array: number[] | null
        }
        Insert: {
          id_client?: number | null
          name_client?: string | null
          id_contract?: number | null
          name_contract?: string | null
          id_idea?: number | null
          name_idea?: string | null
          id_content?: number | null
          name_content?: string | null
          id_social?: number | null
          name_social?: string | null
          date_created?: string | null
          date_completed?: string | null
          date_spiked?: string | null
          date_deadline?: string | null
          date_evergreen?: string | null
          flag_evergreen?: number | null
          flag_replay?: number | null
          flag_tasks?: number | null
          network?: string | null
          type_post?: string | null
          post?: Json | null
          id_user_completed?: number | null
          name_user_completed?: string | null
          id_user_spiked?: number | null
          name_user_spiked?: string | null
          units_content?: number | null
          name_campaign_array?: string[] | null
          id_campaign_array?: number[] | null
        }
        Update: {
          id_client?: number | null
          name_client?: string | null
          id_contract?: number | null
          name_contract?: string | null
          id_idea?: number | null
          name_idea?: string | null
          id_content?: number | null
          name_content?: string | null
          id_social?: number | null
          name_social?: string | null
          date_created?: string | null
          date_completed?: string | null
          date_spiked?: string | null
          date_deadline?: string | null
          date_evergreen?: string | null
          flag_evergreen?: number | null
          flag_replay?: number | null
          flag_tasks?: number | null
          network?: string | null
          type_post?: string | null
          post?: Json | null
          id_user_completed?: number | null
          name_user_completed?: string | null
          id_user_spiked?: number | null
          name_user_spiked?: string | null
          units_content?: number | null
          name_campaign_array?: string[] | null
          id_campaign_array?: number[] | null
        }
        Relationships: []
      }
      app_tasks_operations: {
        Row: {
          id_client: number | null
          name_client: string | null
          id_contract: number | null
          name_contract: string | null
          id_content: number | null
          name_content: string | null
          id_type: number | null
          flag_spiked: number | null
          flag_fast_turnaround: number | null
          date_deadline_production: string | null
          type_content: string | null
          id_task: number | null
          date_completed: string | null
          date_created: string | null
          date_deadline: string | null
          information_notes: string | null
          type_task: string | null
          units_content: number | null
          order_sort: number | null
          id_user_assignee: number | null
          name_user_assignee: string | null
          id_user_assigner: number | null
          name_user_assigner: string | null
          id_user_completed: number | null
          name_user_completed: string | null
          id_user_created: number | null
          name_user_created: string | null
          date_start: string | null
          date_end: string | null
          flag_task_current: string | null
        }
        Insert: {
          id_client?: number | null
          name_client?: string | null
          id_contract?: number | null
          name_contract?: string | null
          id_content?: number | null
          name_content?: string | null
          id_type?: number | null
          flag_spiked?: number | null
          flag_fast_turnaround?: number | null
          date_deadline_production?: string | null
          type_content?: string | null
          id_task?: number | null
          date_completed?: string | null
          date_created?: string | null
          date_deadline?: string | null
          information_notes?: string | null
          type_task?: string | null
          units_content?: number | null
          order_sort?: number | null
          id_user_assignee?: number | null
          name_user_assignee?: string | null
          id_user_assigner?: number | null
          name_user_assigner?: string | null
          id_user_completed?: number | null
          name_user_completed?: string | null
          id_user_created?: number | null
          name_user_created?: string | null
          date_start?: string | null
          date_end?: string | null
          flag_task_current?: string | null
        }
        Update: {
          id_client?: number | null
          name_client?: string | null
          id_contract?: number | null
          name_contract?: string | null
          id_content?: number | null
          name_content?: string | null
          id_type?: number | null
          flag_spiked?: number | null
          flag_fast_turnaround?: number | null
          date_deadline_production?: string | null
          type_content?: string | null
          id_task?: number | null
          date_completed?: string | null
          date_created?: string | null
          date_deadline?: string | null
          information_notes?: string | null
          type_task?: string | null
          units_content?: number | null
          order_sort?: number | null
          id_user_assignee?: number | null
          name_user_assignee?: string | null
          id_user_assigner?: number | null
          name_user_assigner?: string | null
          id_user_completed?: number | null
          name_user_completed?: string | null
          id_user_created?: number | null
          name_user_created?: string | null
          date_start?: string | null
          date_end?: string | null
          flag_task_current?: string | null
        }
        Relationships: []
      }
      content_assets: {
        Row: {
          id: string
          entity_type: string
          entity_id: string
          workspace_id: string | null
          name: string
          url: string
          asset_type: string
          file_size: number | null
          uploaded_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          entity_type: string
          entity_id: string
          workspace_id?: string | null
          name: string
          url: string
          asset_type?: string
          file_size?: number | null
          uploaded_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          entity_type?: string
          entity_id?: string
          workspace_id?: string | null
          name?: string
          url?: string
          asset_type?: string
          file_size?: number | null
          uploaded_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      app_labels_topics: {
        Row: {
          id_client: number | null
          name_client: string | null
          id_topic: number | null
          name_topic: string | null
        }
        Insert: {
          id_client?: number | null
          name_client?: string | null
          id_topic?: number | null
          name_topic?: string | null
        }
        Update: {
          id_client?: number | null
          name_client?: string | null
          id_topic?: number | null
          name_topic?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          date_created: string | null
          date_deleted: string | null
          date_updated: string | null
          email_user: string
          id_firebase: string | null
          id_user: number
          name_user: string | null
          role_job: string | null
          role_user: string | null
          hashed_password: string | null
          provider: string | null
          url_avatar: string | null
        }
        Insert: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          email_user: string
          id_firebase?: string | null
          id_user?: number
          name_user?: string | null
          role_job?: string | null
          role_user?: string | null
          hashed_password?: string | null
          provider?: string | null
          url_avatar?: string | null
        }
        Update: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          email_user?: string
          id_firebase?: string | null
          id_user?: number
          name_user?: string | null
          role_job?: string | null
          role_user?: string | null
          hashed_password?: string | null
          provider?: string | null
          url_avatar?: string | null
        }
        Relationships: []
      }
      lookup_content_events: {
        Row: {
          id_content: number
          id_event: number
        }
        Insert: {
          id_content: number
          id_event: number
        }
        Update: {
          id_content?: number
          id_event?: number
        }
        Relationships: []
      }
      lookup_ideas_topics: {
        Row: {
          id_idea: number
          id_topic: number
        }
        Insert: {
          id_idea: number
          id_topic: number
        }
        Update: {
          id_idea?: number
          id_topic?: number
        }
        Relationships: []
      }
      internal_quotas: {
        Row: {
          id_user: number
          name_user: string | null
          email_user: string | null
          quota_text: number | null
          quota_video: number | null
          quota_visual: number | null
          quota_management: number | null
        }
        Insert: {
          id_user: number
          name_user?: string | null
          email_user?: string | null
          quota_text?: number | null
          quota_video?: number | null
          quota_visual?: number | null
          quota_management?: number | null
        }
        Update: {
          id_user?: number
          name_user?: string | null
          email_user?: string | null
          quota_text?: number | null
          quota_video?: number | null
          quota_visual?: number | null
          quota_management?: number | null
        }
        Relationships: []
      }
      lookup_content_topics: {
        Row: {
          id_content: number
          id_topic: number
        }
        Insert: {
          id_content: number
          id_topic: number
        }
        Update: {
          id_content?: number
          id_topic?: number
        }
        Relationships: []
      }
      app_tasks_internal: {
        Row: {
          name_user_assignee: string | null
          id_user_assignee: number | null
          type_task: string | null
          units_content: number | null
          date_created: string | null
          date_created_month: string | null
          date_deadline: string | null
          date_deadline_month: string | null
          date_completed: string | null
          date_completed_month: string | null
          id_content: number | null
          name_content: string | null
          type_content: string | null
          flag_spiked: number | null
          flag_fast_turnaround: number | null
          id_client: number | null
          name_client: string | null
          flag_task_current: boolean | null
          id_social: number | null
          name_social: string | null
          type_post: string | null
          network: string | null
        }
        Insert: {
          name_user_assignee?: string | null
          id_user_assignee?: number | null
          type_task?: string | null
          units_content?: number | null
          date_created?: string | null
          date_created_month?: string | null
          date_deadline?: string | null
          date_deadline_month?: string | null
          date_completed?: string | null
          date_completed_month?: string | null
          id_content?: number | null
          name_content?: string | null
          type_content?: string | null
          flag_spiked?: number | null
          flag_fast_turnaround?: number | null
          id_client?: number | null
          name_client?: string | null
          flag_task_current?: boolean | null
          id_social?: number | null
          name_social?: string | null
          type_post?: string | null
          network?: string | null
        }
        Update: {
          name_user_assignee?: string | null
          id_user_assignee?: number | null
          type_task?: string | null
          units_content?: number | null
          date_created?: string | null
          date_created_month?: string | null
          date_deadline?: string | null
          date_deadline_month?: string | null
          date_completed?: string | null
          date_completed_month?: string | null
          id_content?: number | null
          name_content?: string | null
          type_content?: string | null
          flag_spiked?: number | null
          flag_fast_turnaround?: number | null
          id_client?: number | null
          name_client?: string | null
          flag_task_current?: boolean | null
          id_social?: number | null
          name_social?: string | null
          type_post?: string | null
          network?: string | null
        }
        Relationships: []
      }
      lookup_social_files: {
        Row: {
          id_social: number
          id_file: number
          flag_thumbnail: number | null
        }
        Insert: {
          id_social: number
          id_file: number
          flag_thumbnail?: number | null
        }
        Update: {
          id_social?: number
          id_file?: number
          flag_thumbnail?: number | null
        }
        Relationships: []
      }
      media_revisions: {
        Row: {
          date_created: string | null
          date_deleted: string | null
          date_updated: string | null
          flag_current: number | null
          id_content: number | null
          id_revision: number
          information_comment: string | null
          information_notes: string | null
          order_version: number | null
        }
        Insert: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          flag_current?: number | null
          id_content?: number | null
          id_revision: number
          information_comment?: string | null
          information_notes?: string | null
          order_version?: number | null
        }
        Update: {
          date_created?: string | null
          date_deleted?: string | null
          date_updated?: string | null
          flag_current?: number | null
          id_content?: number | null
          id_revision?: number
          information_comment?: string | null
          information_notes?: string | null
          order_version?: number | null
        }
        Relationships: []
      }
      profile_links: {
        Row: {
          id: string
          workspace_id: string
          title: string
          url: string
          description: string | null
          icon: string | null
          sort_order: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          title: string
          url: string
          description?: string | null
          icon?: string | null
          sort_order?: number
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          title?: string
          url?: string
          description?: string | null
          icon?: string | null
          sort_order?: number
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      app_tasks_content: {
        Row: {
          id_client: number | null
          name_client: string | null
          id_contract: number | null
          name_contract: string | null
          id_content: number | null
          name_content: string | null
          id_type: number | null
          flag_spiked: number | null
          flag_fast_turnaround: number | null
          date_deadline_production: string | null
          type_content: string | null
          id_task: number | null
          date_completed: string | null
          date_created: string | null
          date_deadline: string | null
          information_notes: string | null
          type_task: string | null
          units_content: number | null
          order_sort: number | null
          id_user_assignee: number | null
          name_user_assignee: string | null
          id_user_assigner: number | null
          name_user_assigner: string | null
          id_user_completed: number | null
          name_user_completed: string | null
          id_user_created: number | null
          name_user_created: string | null
          flag_task_current: string | null
        }
        Insert: {
          id_client?: number | null
          name_client?: string | null
          id_contract?: number | null
          name_contract?: string | null
          id_content?: number | null
          name_content?: string | null
          id_type?: number | null
          flag_spiked?: number | null
          flag_fast_turnaround?: number | null
          date_deadline_production?: string | null
          type_content?: string | null
          id_task?: number | null
          date_completed?: string | null
          date_created?: string | null
          date_deadline?: string | null
          information_notes?: string | null
          type_task?: string | null
          units_content?: number | null
          order_sort?: number | null
          id_user_assignee?: number | null
          name_user_assignee?: string | null
          id_user_assigner?: number | null
          name_user_assigner?: string | null
          id_user_completed?: number | null
          name_user_completed?: string | null
          id_user_created?: number | null
          name_user_created?: string | null
          flag_task_current?: string | null
        }
        Update: {
          id_client?: number | null
          name_client?: string | null
          id_contract?: number | null
          name_contract?: string | null
          id_content?: number | null
          name_content?: string | null
          id_type?: number | null
          flag_spiked?: number | null
          flag_fast_turnaround?: number | null
          date_deadline_production?: string | null
          type_content?: string | null
          id_task?: number | null
          date_completed?: string | null
          date_created?: string | null
          date_deadline?: string | null
          information_notes?: string | null
          type_task?: string | null
          units_content?: number | null
          order_sort?: number | null
          id_user_assignee?: number | null
          name_user_assignee?: string | null
          id_user_assigner?: number | null
          name_user_assigner?: string | null
          id_user_completed?: number | null
          name_user_completed?: string | null
          id_user_created?: number | null
          name_user_created?: string | null
          flag_task_current?: string | null
        }
        Relationships: []
      }
      team_members: {
        Row: {
          id: string
          team_id: string
          user_id: string
          role: string
          joined_at: string
        }
        Insert: {
          id?: string
          team_id: string
          user_id: string
          role?: string
          joined_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          user_id?: string
          role?: string
          joined_at?: string
        }
        Relationships: []
      }
      app_ideas: {
        Row: {
          id_idea: number | null
          name_idea: string | null
          status: string | null
          date_created: string | null
          date_deadline: string | null
          date_commissioned: string | null
          date_pending: string | null
          date_spiked: string | null
          flag_favourite: number | null
          flag_commissioned: number | null
          flag_pending: number | null
          flag_spiked: number | null
          information_brief: string | null
          information_notes: string | null
          link_url: string | null
          id_client: number | null
          name_client: string | null
          id_contract: number | null
          name_contract: string | null
          id_user_submitted: number | null
          name_user_submitted: string | null
          id_user_pending: number | null
          name_user_pending: string | null
          id_user_spiked: number | null
          name_user_spiked: string | null
          id_content: number[] | null
          name_content_content: string[] | null
          type_content_content: string[] | null
          name_user_content_lead: string[] | null
          date_created_content: string[] | null
          date_completed_content: string[] | null
          date_spiked_content: string[] | null
          units_content_content: number[] | null
          id_social: number[] | null
          name_content_social: string[] | null
          network_social: string[] | null
          type_post_social: string[] | null
          date_created_social: string[] | null
          date_completed_social: string[] | null
          date_spiked_social: string[] | null
          units_content_social: number[] | null
          id_topic_array: number[] | null
          name_topic_array: string[] | null
          id_event_array: number[] | null
          name_event_array: string[] | null
          id_campaign_array: number[] | null
          name_campaign_array: string[] | null
          id_file: number | null
          file_path: string | null
          file_bucket: string | null
        }
        Insert: {
          id_idea?: number | null
          name_idea?: string | null
          status?: string | null
          date_created?: string | null
          date_deadline?: string | null
          date_commissioned?: string | null
          date_pending?: string | null
          date_spiked?: string | null
          flag_favourite?: number | null
          flag_commissioned?: number | null
          flag_pending?: number | null
          flag_spiked?: number | null
          information_brief?: string | null
          information_notes?: string | null
          link_url?: string | null
          id_client?: number | null
          name_client?: string | null
          id_contract?: number | null
          name_contract?: string | null
          id_user_submitted?: number | null
          name_user_submitted?: string | null
          id_user_pending?: number | null
          name_user_pending?: string | null
          id_user_spiked?: number | null
          name_user_spiked?: string | null
          id_content?: number[] | null
          name_content_content?: string[] | null
          type_content_content?: string[] | null
          name_user_content_lead?: string[] | null
          date_created_content?: string[] | null
          date_completed_content?: string[] | null
          date_spiked_content?: string[] | null
          units_content_content?: number[] | null
          id_social?: number[] | null
          name_content_social?: string[] | null
          network_social?: string[] | null
          type_post_social?: string[] | null
          date_created_social?: string[] | null
          date_completed_social?: string[] | null
          date_spiked_social?: string[] | null
          units_content_social?: number[] | null
          id_topic_array?: number[] | null
          name_topic_array?: string[] | null
          id_event_array?: number[] | null
          name_event_array?: string[] | null
          id_campaign_array?: number[] | null
          name_campaign_array?: string[] | null
          id_file?: number | null
          file_path?: string | null
          file_bucket?: string | null
        }
        Update: {
          id_idea?: number | null
          name_idea?: string | null
          status?: string | null
          date_created?: string | null
          date_deadline?: string | null
          date_commissioned?: string | null
          date_pending?: string | null
          date_spiked?: string | null
          flag_favourite?: number | null
          flag_commissioned?: number | null
          flag_pending?: number | null
          flag_spiked?: number | null
          information_brief?: string | null
          information_notes?: string | null
          link_url?: string | null
          id_client?: number | null
          name_client?: string | null
          id_contract?: number | null
          name_contract?: string | null
          id_user_submitted?: number | null
          name_user_submitted?: string | null
          id_user_pending?: number | null
          name_user_pending?: string | null
          id_user_spiked?: number | null
          name_user_spiked?: string | null
          id_content?: number[] | null
          name_content_content?: string[] | null
          type_content_content?: string[] | null
          name_user_content_lead?: string[] | null
          date_created_content?: string[] | null
          date_completed_content?: string[] | null
          date_spiked_content?: string[] | null
          units_content_content?: number[] | null
          id_social?: number[] | null
          name_content_social?: string[] | null
          network_social?: string[] | null
          type_post_social?: string[] | null
          date_created_social?: string[] | null
          date_completed_social?: string[] | null
          date_spiked_social?: string[] | null
          units_content_social?: number[] | null
          id_topic_array?: number[] | null
          name_topic_array?: string[] | null
          id_event_array?: number[] | null
          name_event_array?: string[] | null
          id_campaign_array?: number[] | null
          name_campaign_array?: string[] | null
          id_file?: number | null
          file_path?: string | null
          file_bucket?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [key: string]: {
        Row: Record<string, any>
        Relationships: []
      }
    }
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never
