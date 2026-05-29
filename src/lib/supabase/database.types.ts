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
          created_at?: string
        }
        Update: {
          store_name?: string
          store_code?: string
          city?: string | null
          region?: string
          tier?: string
          manager_id?: string | null
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
          created_at?: string
        }
        Update: {
          level?: number
          triggered_by?: string | null
          reason?: string
          resolved?: boolean
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
