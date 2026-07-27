export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          name: string
          email: string
          role: string
          region: string | null
          department: string | null
          store_id: string | null
          status: string
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id: string
          name: string
          email: string
          role?: string
          region?: string | null
          department?: string | null
          store_id?: string | null
          status?: string
          avatar_url?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          email?: string
          role?: string
          region?: string | null
          department?: string | null
          store_id?: string | null
          status?: string
          avatar_url?: string | null
        }
      }
      stores: {
        Row: {
          id: string
          store_name: string
          store_code: string
          city: string | null
          region: string
          tier: string
          manager_id: string | null
          am_name: string | null
          trainer_name: string | null
          hr_name: string | null
          created_at: string
        }
        Insert: {
          id?: string
          store_name: string
          store_code: string
          city?: string | null
          region: string
          tier?: string
          manager_id?: string | null
          am_name?: string | null
          trainer_name?: string | null
          hr_name?: string | null
          created_at?: string
        }
        Update: {
          store_name?: string
          store_code?: string
          city?: string | null
          region?: string
          tier?: string
          manager_id?: string | null
          am_name?: string | null
          trainer_name?: string | null
          hr_name?: string | null
        }
      }
      tickets: {
        Row: {
          id: string
          ticket_code: string
          title: string
          description: string | null
          category: string
          sub_category: string | null
          severity: string
          status: string
          store_id: string | null
          raised_by: string | null
          assigned_to: string | null
          source_type: string
          sla_deadline: string | null
          first_response_at: string | null
          resolved_at: string | null
          closed_at: string | null
          reopen_count: number
          created_at: string
          updated_at: string
          // Workflow v3
          blocked: boolean | null
          blocked_reason: string | null
          blocked_at: string | null
          verify_reminders_sent: number | null
          sla_breach_notified: boolean | null
          // Assets integration
          asset_id: string | null
          // Intelligence integration
          intelligence_source: boolean | null
          intelligence_submission_id: string | null
          intelligence_section_id: string | null
          intelligence_program_id: string | null
          intelligence_program_name: string | null
          intelligence_store_code: string | null
          intelligence_deductions: Json | null
          intelligence_audit_score: number | null
          intelligence_audit_pct: number | null
          intelligence_ai_confidence: number | null
          intelligence_pattern_flag: boolean | null
          intelligence_pattern_note: string | null
          intelligence_suggested_role: string | null
          secondary_departments: string[] | null
          root_cause_category: string | null
        }
        Insert: {
          id?: string
          ticket_code: string
          title: string
          description?: string | null
          category: string
          sub_category?: string | null
          severity?: string
          status?: string
          store_id?: string | null
          raised_by?: string | null
          assigned_to?: string | null
          source_type?: string
          sla_deadline?: string | null
          first_response_at?: string | null
          resolved_at?: string | null
          closed_at?: string | null
          reopen_count?: number
          created_at?: string
          updated_at?: string
          blocked?: boolean | null
          blocked_reason?: string | null
          blocked_at?: string | null
          verify_reminders_sent?: number | null
          sla_breach_notified?: boolean | null
          asset_id?: string | null
          intelligence_source?: boolean | null
          intelligence_submission_id?: string | null
          intelligence_section_id?: string | null
          intelligence_program_id?: string | null
          intelligence_program_name?: string | null
          intelligence_store_code?: string | null
          intelligence_deductions?: Json | null
          intelligence_audit_score?: number | null
          intelligence_audit_pct?: number | null
          intelligence_ai_confidence?: number | null
          intelligence_pattern_flag?: boolean | null
          intelligence_pattern_note?: string | null
          intelligence_suggested_role?: string | null
          secondary_departments?: string[] | null
          root_cause_category?: string | null
        }
        Update: {
          ticket_code?: string
          title?: string
          description?: string | null
          category?: string
          sub_category?: string | null
          severity?: string
          status?: string
          store_id?: string | null
          raised_by?: string | null
          assigned_to?: string | null
          source_type?: string
          sla_deadline?: string | null
          first_response_at?: string | null
          resolved_at?: string | null
          closed_at?: string | null
          reopen_count?: number
          updated_at?: string
          blocked?: boolean | null
          blocked_reason?: string | null
          blocked_at?: string | null
          verify_reminders_sent?: number | null
          sla_breach_notified?: boolean | null
          asset_id?: string | null
          intelligence_source?: boolean | null
          intelligence_submission_id?: string | null
          intelligence_section_id?: string | null
          intelligence_program_id?: string | null
          intelligence_program_name?: string | null
          intelligence_store_code?: string | null
          intelligence_deductions?: Json | null
          intelligence_audit_score?: number | null
          intelligence_audit_pct?: number | null
          intelligence_ai_confidence?: number | null
          intelligence_pattern_flag?: boolean | null
          intelligence_pattern_note?: string | null
          intelligence_suggested_role?: string | null
          secondary_departments?: string[] | null
          root_cause_category?: string | null
        }
      }
      escalations: {
        Row: {
          id: string
          ticket_id: string
          level: number
          triggered_at: string
          triggered_by: string | null
          reason: string
          resolved: boolean
          policy_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          ticket_id: string
          level?: number
          triggered_at?: string
          triggered_by?: string | null
          reason: string
          resolved?: boolean
          policy_id?: string | null
          created_at?: string
        }
        Update: {
          level?: number
          triggered_by?: string | null
          reason?: string
          resolved?: boolean
          policy_id?: string | null
        }
      }
      comments: {
        Row: {
          id: string
          ticket_id: string
          author_id: string | null
          content: string
          is_status_change: boolean
          old_status: string | null
          new_status: string | null
          created_at: string
        }
        Insert: {
          id?: string
          ticket_id: string
          author_id?: string | null
          content: string
          is_status_change?: boolean
          old_status?: string | null
          new_status?: string | null
          created_at?: string
        }
        Update: {
          content?: string
          is_status_change?: boolean
          old_status?: string | null
          new_status?: string | null
        }
      }
      attachments: {
        Row: {
          id: string
          ticket_id: string
          uploaded_by: string | null
          file_url: string
          file_name: string | null
          file_type: string | null
          created_at: string
        }
        Insert: {
          id?: string
          ticket_id: string
          uploaded_by?: string | null
          file_url: string
          file_name?: string | null
          file_type?: string | null
          created_at?: string
        }
        Update: {
          file_url?: string
          file_name?: string | null
          file_type?: string | null
        }
      }

      asset_categories: {
        Row: {
          id: string
          name: string
          department: string
          default_pm_interval_days: number | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          department?: string
          default_pm_interval_days?: number | null
          created_at?: string
        }
        Update: {
          name?: string
          department?: string
          default_pm_interval_days?: number | null
        }
      }

      vendors: {
        Row: {
          id: string
          name: string
          contact_name: string | null
          phone: string | null
          email: string | null
          sla_hours: number | null
          notes: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          contact_name?: string | null
          phone?: string | null
          email?: string | null
          sla_hours?: number | null
          notes?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          name?: string
          contact_name?: string | null
          phone?: string | null
          email?: string | null
          sla_hours?: number | null
          notes?: string | null
          is_active?: boolean
        }
      }

      asset_pm_tasks: {
        Row: {
          id: string
          asset_id: string
          title: string
          daypart: string
          interval_days: number | null
          last_done_at: string | null
          next_due_at: string | null
          last_alert_at: string | null
          is_active: boolean
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          asset_id: string
          title: string
          daypart?: string
          interval_days?: number | null
          last_done_at?: string | null
          next_due_at?: string | null
          last_alert_at?: string | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
        }
        Update: {
          title?: string
          daypart?: string
          interval_days?: number | null
          next_due_at?: string | null
          is_active?: boolean
        }
      }

      asset_pm_log: {
        Row: {
          id: string
          task_id: string | null
          asset_id: string
          done_by: string | null
          done_at: string
          note: string | null
        }
        Insert: {
          id?: string
          task_id?: string | null
          asset_id: string
          done_by?: string | null
          done_at?: string
          note?: string | null
        }
        Update: {
          note?: string | null
        }
      }

      assets: {
        Row: {
          id: string
          asset_code: string
          name: string
          category_id: string
          store_id: string
          make: string | null
          model: string | null
          serial_no: string | null
          purchase_date: string | null
          warranty_until: string | null
          amc_vendor_id: string | null
          amc_until: string | null
          status: string
          notes: string | null
          warranty_alert_stage: number | null
          amc_alert_stage: number | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          asset_code?: string
          name: string
          category_id: string
          store_id: string
          make?: string | null
          model?: string | null
          serial_no?: string | null
          purchase_date?: string | null
          warranty_until?: string | null
          amc_vendor_id?: string | null
          amc_until?: string | null
          status?: string
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          asset_code?: string
          name?: string
          category_id?: string
          store_id?: string
          make?: string | null
          model?: string | null
          serial_no?: string | null
          purchase_date?: string | null
          warranty_until?: string | null
          amc_vendor_id?: string | null
          amc_until?: string | null
          status?: string
          notes?: string | null
          updated_at?: string
        }
      }

      asset_transfers: {
        Row: {
          id: string
          asset_id: string
          from_store_id: string
          to_store_id: string
          status: string
          requested_by: string | null
          received_by: string | null
          notes: string | null
          requested_at: string
          in_transit_at: string | null
          received_at: string | null
          cancelled_at: string | null
        }
        Insert: {
          id?: string
          asset_id: string
          from_store_id: string
          to_store_id: string
          status?: string
          requested_by?: string | null
          received_by?: string | null
          notes?: string | null
          requested_at?: string
        }
        Update: {
          status?: string
          received_by?: string | null
          notes?: string | null
        }
      }

      spare_parts: {
        Row: {
          id: string
          store_id: string
          category_id: string | null
          name: string
          sku: string | null
          qty_on_hand: number
          reorder_threshold: number | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          store_id: string
          category_id?: string | null
          name: string
          sku?: string | null
          qty_on_hand?: number
          reorder_threshold?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          name?: string
          sku?: string | null
          qty_on_hand?: number
          reorder_threshold?: number | null
          notes?: string | null
          updated_at?: string
        }
      }

      spare_part_usage_log: {
        Row: {
          id: string
          part_id: string
          ticket_id: string | null
          qty: number
          used_by: string | null
          used_at: string
        }
        Insert: {
          id?: string
          part_id: string
          ticket_id?: string | null
          qty: number
          used_by?: string | null
          used_at?: string
        }
        Update: Record<string, never>
      }

      department_routing: {
        Row: {
          id: string
          department: string
          region: string | null
          owner_id: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          department: string
          region?: string | null
          owner_id: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          department?: string
          region?: string | null
          owner_id?: string
          is_active?: boolean
          updated_at?: string
        }
      }

      escalation_policies: {
        Row: {
          id: string
          department: string
          region: string | null
          severity: string | null
          level: number
          after_minutes: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          department: string
          region?: string | null
          severity?: string | null
          level: number
          after_minutes?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          department?: string
          region?: string | null
          severity?: string | null
          level?: number
          after_minutes?: number
          is_active?: boolean
          updated_at?: string
        }
      }

      escalation_policy_people: {
        Row: {
          policy_id: string
          profile_id: string
          created_at: string
        }
        Insert: {
          policy_id: string
          profile_id: string
          created_at?: string
        }
        Update: {
          policy_id?: string
          profile_id?: string
        }
      }

      employee_roster: {
        Row: {
          id: string
          emp_id: string
          name: string
          email: string | null
          department: string | null
          designation: string | null
          store_code: string | null
          region: string | null
          is_active: boolean
          convex_id: string | null
          last_synced_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          emp_id: string
          name: string
          email?: string | null
          department?: string | null
          designation?: string | null
          store_code?: string | null
          region?: string | null
          is_active?: boolean
          convex_id?: string | null
          last_synced_at?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          email?: string | null
          department?: string | null
          designation?: string | null
          store_code?: string | null
          region?: string | null
          is_active?: boolean
          convex_id?: string | null
          last_synced_at?: string | null
        }
      }
    }
  }
}

export type Profile = Database['public']['Tables']['profiles']['Row']
export type DepartmentRouting = Database['public']['Tables']['department_routing']['Row']
export type EscalationPolicy = Database['public']['Tables']['escalation_policies']['Row']
export type EscalationPolicyPerson = Database['public']['Tables']['escalation_policy_people']['Row']
export type AssetCategory = Database['public']['Tables']['asset_categories']['Row']
export type Vendor = Database['public']['Tables']['vendors']['Row']
export type Asset = Database['public']['Tables']['assets']['Row']
export type AssetPmTask = Database['public']['Tables']['asset_pm_tasks']['Row']
export type AssetPmLog = Database['public']['Tables']['asset_pm_log']['Row']
export type AssetTransfer = Database['public']['Tables']['asset_transfers']['Row']
export type SparePart = Database['public']['Tables']['spare_parts']['Row']
export type SparePartUsageLog = Database['public']['Tables']['spare_part_usage_log']['Row']

export type AssetWithRelations = Asset & {
  category?: AssetCategory | null
  store?: Store | null
  amc_vendor?: Vendor | null
}
export type Store = Database['public']['Tables']['stores']['Row']
export type EmployeeRoster = Database['public']['Tables']['employee_roster']['Row']
export type Ticket = Database['public']['Tables']['tickets']['Row']
export type Escalation = Database['public']['Tables']['escalations']['Row']
export type Comment = Database['public']['Tables']['comments']['Row']
export type Attachment = Database['public']['Tables']['attachments']['Row']

export type TicketWithRelations = Ticket & {
  store?: Store | null
  raised_by_profile?: Profile | null
  assigned_to_profile?: Profile | null
  escalations?: Escalation[]
  comments?: Comment[]
}

// A ladder rung plus the specific people looped in at it (matrix editor).
export type EscalationPolicyWithPeople = EscalationPolicy & {
  people: Pick<Profile, 'id' | 'name' | 'email' | 'department' | 'role'>[]
}
