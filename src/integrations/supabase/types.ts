export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity: string
          entity_id: string | null
          id: number
          new_data: Json | null
          old_data: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      buildings: {
        Row: {
          actual_completion: string | null
          budget: number
          code: string
          construction_start: string | null
          created_at: string
          expected_completion: string | null
          ground_floor_config: string | null
          id: string
          name: string
          notes: string | null
          planned_floors: number
          progress_pct: number
          project_id: string
          status: Database["public"]["Enums"]["work_status"]
          updated_at: string
          wing: string | null
        }
        Insert: {
          actual_completion?: string | null
          budget?: number
          code: string
          construction_start?: string | null
          created_at?: string
          expected_completion?: string | null
          ground_floor_config?: string | null
          id?: string
          name: string
          notes?: string | null
          planned_floors?: number
          progress_pct?: number
          project_id: string
          status?: Database["public"]["Enums"]["work_status"]
          updated_at?: string
          wing?: string | null
        }
        Update: {
          actual_completion?: string | null
          budget?: number
          code?: string
          construction_start?: string | null
          created_at?: string
          expected_completion?: string | null
          ground_floor_config?: string | null
          id?: string
          name?: string
          notes?: string | null
          planned_floors?: number
          progress_pct?: number
          project_id?: string
          status?: Database["public"]["Enums"]["work_status"]
          updated_at?: string
          wing?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "buildings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          booking_prefix: string
          cin: string | null
          created_at: string
          email: string | null
          fy_start_month: number
          gst_rate_commercial: number
          gst_rate_residential: number
          gstin: string | null
          id: string
          invoice_prefix: string
          invoice_terms: string | null
          legal_name: string | null
          logo_url: string | null
          name: string
          notification_settings: Json
          office_address: string | null
          pan: string | null
          phone: string | null
          receipt_prefix: string
          registered_address: string | null
          rera_details: string | null
          rera_promoter_id: string | null
          tan: string | null
          tds_property_rate: number
          updated_at: string
        }
        Insert: {
          booking_prefix?: string
          cin?: string | null
          created_at?: string
          email?: string | null
          fy_start_month?: number
          gst_rate_commercial?: number
          gst_rate_residential?: number
          gstin?: string | null
          id?: string
          invoice_prefix?: string
          invoice_terms?: string | null
          legal_name?: string | null
          logo_url?: string | null
          name: string
          notification_settings?: Json
          office_address?: string | null
          pan?: string | null
          phone?: string | null
          receipt_prefix?: string
          registered_address?: string | null
          rera_details?: string | null
          rera_promoter_id?: string | null
          tan?: string | null
          tds_property_rate?: number
          updated_at?: string
        }
        Update: {
          booking_prefix?: string
          cin?: string | null
          created_at?: string
          email?: string | null
          fy_start_month?: number
          gst_rate_commercial?: number
          gst_rate_residential?: number
          gstin?: string | null
          id?: string
          invoice_prefix?: string
          invoice_terms?: string | null
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          notification_settings?: Json
          office_address?: string | null
          pan?: string | null
          phone?: string | null
          receipt_prefix?: string
          registered_address?: string | null
          rera_details?: string | null
          rera_promoter_id?: string | null
          tan?: string | null
          tds_property_rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      company_bank_accounts: {
        Row: {
          account_name: string
          account_number: string
          account_type: string
          bank_name: string
          branch: string | null
          company_id: string
          created_at: string
          id: string
          ifsc: string
          is_primary: boolean
          purpose: string | null
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          account_name: string
          account_number: string
          account_type?: string
          bank_name: string
          branch?: string | null
          company_id: string
          created_at?: string
          id?: string
          ifsc: string
          is_primary?: boolean
          purpose?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          account_name?: string
          account_number?: string
          account_type?: string
          bank_name?: string
          branch?: string | null
          company_id?: string
          created_at?: string
          id?: string
          ifsc?: string
          is_primary?: boolean
          purpose?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_periods: {
        Row: {
          company_id: string
          created_at: string
          end_date: string
          id: string
          is_closed: boolean
          is_current: boolean
          label: string
          start_date: string
        }
        Insert: {
          company_id: string
          created_at?: string
          end_date: string
          id?: string
          is_closed?: boolean
          is_current?: boolean
          label: string
          start_date: string
        }
        Update: {
          company_id?: string
          created_at?: string
          end_date?: string
          id?: string
          is_closed?: boolean
          is_current?: boolean
          label?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_periods_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      floors: {
        Row: {
          building_id: string
          completion_pct: number
          construction_status: Database["public"]["Enums"]["work_status"]
          created_at: string
          floor_number: number
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          building_id: string
          completion_pct?: number
          construction_status?: Database["public"]["Enums"]["work_status"]
          created_at?: string
          floor_number: number
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          building_id?: string
          completion_pct?: number
          construction_status?: Database["public"]["Enums"]["work_status"]
          created_at?: string
          floor_number?: number
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "floors_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floors_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_stats"
            referencedColumns: ["building_id"]
          },
        ]
      }
      item_categories: {
        Row: {
          code: string
          company_id: string
          created_at: string
          description: string | null
          id: string
          is_demo: boolean
          name: string
          parent_id: string | null
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_demo?: boolean
          name: string
          parent_id?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          parent_id?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "item_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          category_id: string
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          hsn_sac: string | null
          id: string
          is_demo: boolean
          maximum_stock: number | null
          minimum_stock: number
          name: string
          preferred_vendor_id: string | null
          reorder_level: number
          specification: string | null
          status: Database["public"]["Enums"]["record_status"]
          unit_id: string
          updated_at: string
        }
        Insert: {
          category_id: string
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          hsn_sac?: string | null
          id?: string
          is_demo?: boolean
          maximum_stock?: number | null
          minimum_stock?: number
          name: string
          preferred_vendor_id?: string | null
          reorder_level?: number
          specification?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          unit_id: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          hsn_sac?: string | null
          id?: string
          is_demo?: boolean
          maximum_stock?: number | null
          minimum_stock?: number
          name?: string
          preferred_vendor_id?: string | null
          reorder_level?: number
          specification?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "item_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_preferred_vendor_id_fkey"
            columns: ["preferred_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          code: string
          description: string
          module: string
          sort_order: number
        }
        Insert: {
          code: string
          description: string
          module: string
          sort_order?: number
        }
        Update: {
          code?: string
          description?: string
          module?: string
          sort_order?: number
        }
        Relationships: []
      }
      pr_number_counters: {
        Row: {
          last_value: number
          year: number
        }
        Insert: {
          last_value?: number
          year: number
        }
        Update: {
          last_value?: number
          year?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          company_id: string | null
          created_at: string
          department: string | null
          designation: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          department?: string | null
          designation?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          department?: string | null
          designation?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      project_sites: {
        Row: {
          address: string | null
          code: string
          company_id: string
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_demo: boolean
          name: string
          project_id: string
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          code: string
          company_id: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          name: string
          project_id: string
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string
          company_id?: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          name?: string
          project_id?: string
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_sites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_sites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          actual_completion_date: string | null
          address: string | null
          architect: string | null
          budget: number
          city: string | null
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          developer_details: string | null
          development_area_sqft: number | null
          estimated_cost: number
          expected_completion_date: string | null
          id: string
          is_demo: boolean
          land_area_sqm: number | null
          location: string | null
          name: string
          notes: string | null
          pincode: string | null
          project_manager_id: string | null
          project_type: string | null
          record_status: Database["public"]["Enums"]["record_status"]
          rera_number: string | null
          rera_registration_date: string | null
          rera_valid_until: string | null
          site_engineer_id: string | null
          start_date: string | null
          state: string | null
          status: Database["public"]["Enums"]["project_status"]
          structural_consultant: string | null
          updated_at: string
        }
        Insert: {
          actual_completion_date?: string | null
          address?: string | null
          architect?: string | null
          budget?: number
          city?: string | null
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          developer_details?: string | null
          development_area_sqft?: number | null
          estimated_cost?: number
          expected_completion_date?: string | null
          id?: string
          is_demo?: boolean
          land_area_sqm?: number | null
          location?: string | null
          name: string
          notes?: string | null
          pincode?: string | null
          project_manager_id?: string | null
          project_type?: string | null
          record_status?: Database["public"]["Enums"]["record_status"]
          rera_number?: string | null
          rera_registration_date?: string | null
          rera_valid_until?: string | null
          site_engineer_id?: string | null
          start_date?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          structural_consultant?: string | null
          updated_at?: string
        }
        Update: {
          actual_completion_date?: string | null
          address?: string | null
          architect?: string | null
          budget?: number
          city?: string | null
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          developer_details?: string | null
          development_area_sqft?: number | null
          estimated_cost?: number
          expected_completion_date?: string | null
          id?: string
          is_demo?: boolean
          land_area_sqm?: number | null
          location?: string | null
          name?: string
          notes?: string | null
          pincode?: string | null
          project_manager_id?: string | null
          project_type?: string | null
          record_status?: Database["public"]["Enums"]["record_status"]
          rera_number?: string | null
          rera_registration_date?: string | null
          rera_valid_until?: string | null
          site_engineer_id?: string | null
          start_date?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          structural_consultant?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_project_manager_id_fkey"
            columns: ["project_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_site_engineer_id_fkey"
            columns: ["site_engineer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_request_approvals: {
        Row: {
          acted_at: string
          acted_by: string | null
          action: Database["public"]["Enums"]["pr_action"]
          comment: string | null
          id: string
          new_status: Database["public"]["Enums"]["pr_status"] | null
          previous_status: Database["public"]["Enums"]["pr_status"] | null
          purchase_request_id: string
        }
        Insert: {
          acted_at?: string
          acted_by?: string | null
          action: Database["public"]["Enums"]["pr_action"]
          comment?: string | null
          id?: string
          new_status?: Database["public"]["Enums"]["pr_status"] | null
          previous_status?: Database["public"]["Enums"]["pr_status"] | null
          purchase_request_id: string
        }
        Update: {
          acted_at?: string
          acted_by?: string | null
          action?: Database["public"]["Enums"]["pr_action"]
          comment?: string | null
          id?: string
          new_status?: Database["public"]["Enums"]["pr_status"] | null
          previous_status?: Database["public"]["Enums"]["pr_status"] | null
          purchase_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_request_approvals_acted_by_fkey"
            columns: ["acted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_approvals_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_request_items: {
        Row: {
          created_at: string
          description: string | null
          estimated_amount: number
          estimated_rate: number | null
          id: string
          line_no: number
          material_id: string
          notes: string | null
          purchase_request_id: string
          purpose: string | null
          quantity: number
          required_by: string | null
          unit_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          estimated_amount?: number
          estimated_rate?: number | null
          id?: string
          line_no?: number
          material_id: string
          notes?: string | null
          purchase_request_id: string
          purpose?: string | null
          quantity: number
          required_by?: string | null
          unit_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          estimated_amount?: number
          estimated_rate?: number | null
          id?: string
          line_no?: number
          material_id?: string
          notes?: string | null
          purchase_request_id?: string
          purpose?: string | null
          quantity?: number
          required_by?: string | null
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_request_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_items_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          building_id: string | null
          company_id: string
          created_at: string
          estimated_total: number
          floor_id: string | null
          id: string
          pr_number: string
          priority: Database["public"]["Enums"]["pr_priority"]
          project_id: string
          purpose: string | null
          remarks: string | null
          request_date: string
          request_type: Database["public"]["Enums"]["pr_request_type"]
          requested_by: string
          required_by: string
          status: Database["public"]["Enums"]["pr_status"]
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          building_id?: string | null
          company_id: string
          created_at?: string
          estimated_total?: number
          floor_id?: string | null
          id?: string
          pr_number: string
          priority?: Database["public"]["Enums"]["pr_priority"]
          project_id: string
          purpose?: string | null
          remarks?: string | null
          request_date?: string
          request_type?: Database["public"]["Enums"]["pr_request_type"]
          requested_by: string
          required_by: string
          status?: Database["public"]["Enums"]["pr_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          building_id?: string | null
          company_id?: string
          created_at?: string
          estimated_total?: number
          floor_id?: string | null
          id?: string
          pr_number?: string
          priority?: Database["public"]["Enums"]["pr_priority"]
          project_id?: string
          purpose?: string | null
          remarks?: string | null
          request_date?: string
          request_type?: Database["public"]["Enums"]["pr_request_type"]
          requested_by?: string
          required_by?: string
          status?: Database["public"]["Enums"]["pr_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_stats"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "purchase_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_floor_id_fkey"
            columns: ["floor_id"]
            isOneToOne: false
            referencedRelation: "floors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_code: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          permission_code: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          permission_code?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
        ]
      }
      unit_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_status: Database["public"]["Enums"]["unit_status"] | null
          id: string
          reason: string | null
          to_status: Database["public"]["Enums"]["unit_status"]
          unit_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["unit_status"] | null
          id?: string
          reason?: string | null
          to_status: Database["public"]["Enums"]["unit_status"]
          unit_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["unit_status"] | null
          id?: string
          reason?: string | null
          to_status?: Database["public"]["Enums"]["unit_status"]
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_status_history_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          balcony_area: number
          base_price: number
          base_rate: number
          booking_amount: number
          building_id: string
          built_up_area: number
          carpet_area: number
          created_at: string
          facing: string | null
          floor_id: string
          floor_rise_amount: number
          floor_rise_rate: number
          gst_amount: number
          gst_rate: number
          hold_reason: string | null
          hold_until: string | null
          id: string
          notes: string | null
          other_charges: number
          parking_charges: number
          parking_count: number
          parking_details: string | null
          project_id: string
          record_status: Database["public"]["Enums"]["record_status"]
          saleable_area: number
          status: Database["public"]["Enums"]["unit_status"]
          taxable_value: number
          terrace_area: number
          total_agreement_value: number
          unit_number: string
          unit_type: Database["public"]["Enums"]["unit_type"]
          updated_at: string
        }
        Insert: {
          balcony_area?: number
          base_price?: number
          base_rate: number
          booking_amount?: number
          building_id: string
          built_up_area: number
          carpet_area: number
          created_at?: string
          facing?: string | null
          floor_id: string
          floor_rise_amount?: number
          floor_rise_rate?: number
          gst_amount?: number
          gst_rate?: number
          hold_reason?: string | null
          hold_until?: string | null
          id?: string
          notes?: string | null
          other_charges?: number
          parking_charges?: number
          parking_count?: number
          parking_details?: string | null
          project_id: string
          record_status?: Database["public"]["Enums"]["record_status"]
          saleable_area: number
          status?: Database["public"]["Enums"]["unit_status"]
          taxable_value?: number
          terrace_area?: number
          total_agreement_value?: number
          unit_number: string
          unit_type: Database["public"]["Enums"]["unit_type"]
          updated_at?: string
        }
        Update: {
          balcony_area?: number
          base_price?: number
          base_rate?: number
          booking_amount?: number
          building_id?: string
          built_up_area?: number
          carpet_area?: number
          created_at?: string
          facing?: string | null
          floor_id?: string
          floor_rise_amount?: number
          floor_rise_rate?: number
          gst_amount?: number
          gst_rate?: number
          hold_reason?: string | null
          hold_until?: string | null
          id?: string
          notes?: string | null
          other_charges?: number
          parking_charges?: number
          parking_count?: number
          parking_details?: string | null
          project_id?: string
          record_status?: Database["public"]["Enums"]["record_status"]
          saleable_area?: number
          status?: Database["public"]["Enums"]["unit_status"]
          taxable_value?: number
          terrace_area?: number
          total_agreement_value?: number
          unit_number?: string
          unit_type?: Database["public"]["Enums"]["unit_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_stats"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "units_floor_id_fkey"
            columns: ["floor_id"]
            isOneToOne: false
            referencedRelation: "floors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      units_of_measure: {
        Row: {
          code: string
          company_id: string
          created_at: string
          decimal_places: number
          id: string
          is_demo: boolean
          name: string
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          decimal_places?: number
          id?: string
          is_demo?: boolean
          name: string
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          decimal_places?: number
          id?: string
          is_demo?: boolean
          name?: string
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_of_measure_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_project_assignments: {
        Row: {
          created_at: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_project_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_categories: {
        Row: {
          company_id: string
          created_at: string
          description: string | null
          id: string
          is_demo: boolean
          name: string
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_demo?: boolean
          name: string
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_category_links: {
        Row: {
          category_id: string
          created_at: string
          vendor_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          vendor_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_category_links_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "vendor_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_category_links_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string | null
          approval_status: string
          bank_account_name: string | null
          bank_account_number: string | null
          bank_name: string | null
          city: string | null
          code: string
          company_id: string
          company_name: string
          contact_person: string | null
          created_at: string
          created_by: string | null
          email: string | null
          gstin: string | null
          id: string
          ifsc: string | null
          is_demo: boolean
          mobile: string | null
          notes: string | null
          pan: string | null
          payment_terms_days: number
          pincode: string | null
          state: string | null
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          approval_status?: string
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          city?: string | null
          code: string
          company_id: string
          company_name: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gstin?: string | null
          id?: string
          ifsc?: string | null
          is_demo?: boolean
          mobile?: string | null
          notes?: string | null
          pan?: string | null
          payment_terms_days?: number
          pincode?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          approval_status?: string
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          city?: string | null
          code?: string
          company_id?: string
          company_name?: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gstin?: string | null
          id?: string
          ifsc?: string | null
          is_demo?: boolean
          mobile?: string | null
          notes?: string | null
          pan?: string | null
          payment_terms_days?: number
          pincode?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendors_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          address: string | null
          code: string
          company_id: string
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_demo: boolean
          name: string
          notes: string | null
          project_id: string | null
          responsible_user_id: string | null
          site_id: string | null
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
          warehouse_type: string
        }
        Insert: {
          address?: string | null
          code: string
          company_id: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          name: string
          notes?: string | null
          project_id?: string | null
          responsible_user_id?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
          warehouse_type: string
        }
        Update: {
          address?: string | null
          code?: string
          company_id?: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          name?: string
          notes?: string | null
          project_id?: string | null
          responsible_user_id?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
          warehouse_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouses_responsible_user_id_fkey"
            columns: ["responsible_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouses_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "project_sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_building_stats: {
        Row: {
          available_units: number | null
          booked_units: number | null
          building_id: string | null
          hold_units: number | null
          inventory_value: number | null
          project_id: string | null
          saleable_area: number | null
          sold_units: number | null
          total_units: number | null
          unsold_value: number | null
          withdrawn_units: number | null
        }
        Relationships: [
          {
            foreignKeyName: "buildings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_access_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      ensure_profile: {
        Args: never
        Returns: {
          company_id: string | null
          created_at: string
          department: string | null
          designation: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_units: {
        Args: {
          _base_rate: number
          _booking_amount?: number
          _building_id: string
          _built_up: number
          _carpet: number
          _floor_from: number
          _floor_rise_step?: number
          _floor_to: number
          _gst_rate?: number
          _other_charges?: number
          _parking_charges?: number
          _saleable: number
          _unit_type: Database["public"]["Enums"]["unit_type"]
          _units_per_floor: number
        }
        Returns: number
      }
      has_permission: {
        Args: { _code: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_active_user: { Args: { _user_id: string }; Returns: boolean }
      my_permissions: { Args: never; Returns: string[] }
      pr_transition: {
        Args: {
          _action: Database["public"]["Enums"]["pr_action"]
          _comment?: string
          _pr_id: string
        }
        Returns: Database["public"]["Enums"]["pr_status"]
      }
      set_unit_status: {
        Args: {
          _hold_until?: string
          _reason?: string
          _status: Database["public"]["Enums"]["unit_status"]
          _unit_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "director"
        | "sales_manager"
        | "sales_executive"
        | "accounts_manager"
        | "purchase_manager"
        | "site_engineer"
        | "project_manager"
        | "accountant"
        | "store_manager"
        | "auditor"
      pr_action:
        | "created"
        | "submitted"
        | "approved"
        | "rejected"
        | "returned"
        | "cancelled"
      pr_priority: "low" | "normal" | "high" | "urgent"
      pr_request_type: "material" | "equipment" | "service" | "other"
      pr_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "rejected"
        | "cancelled"
      project_status:
        | "planning"
        | "approval"
        | "under_construction"
        | "near_completion"
        | "completed"
        | "on_hold"
        | "cancelled"
      record_status: "active" | "inactive"
      unit_status:
        | "available"
        | "hold"
        | "booked"
        | "agreement_pending"
        | "agreement_done"
        | "registered"
        | "possession_pending"
        | "possession_completed"
        | "cancelled"
      unit_type: "1bhk" | "2bhk" | "3bhk" | "4bhk" | "shop" | "office" | "other"
      work_status: "not_started" | "in_progress" | "on_hold" | "completed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "director",
        "sales_manager",
        "sales_executive",
        "accounts_manager",
        "purchase_manager",
        "site_engineer",
        "project_manager",
        "accountant",
        "store_manager",
        "auditor",
      ],
      pr_action: [
        "created",
        "submitted",
        "approved",
        "rejected",
        "returned",
        "cancelled",
      ],
      pr_priority: ["low", "normal", "high", "urgent"],
      pr_request_type: ["material", "equipment", "service", "other"],
      pr_status: [
        "draft",
        "pending_approval",
        "approved",
        "rejected",
        "cancelled",
      ],
      project_status: [
        "planning",
        "approval",
        "under_construction",
        "near_completion",
        "completed",
        "on_hold",
        "cancelled",
      ],
      record_status: ["active", "inactive"],
      unit_status: [
        "available",
        "hold",
        "booked",
        "agreement_pending",
        "agreement_done",
        "registered",
        "possession_pending",
        "possession_completed",
        "cancelled",
      ],
      unit_type: ["1bhk", "2bhk", "3bhk", "4bhk", "shop", "office", "other"],
      work_status: ["not_started", "in_progress", "on_hold", "completed"],
    },
  },
} as const
