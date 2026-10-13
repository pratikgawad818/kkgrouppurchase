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
      accounts: {
        Row: {
          account_type: string
          code: string
          company_id: string
          created_at: string
          id: string
          is_system: boolean
          name: string
        }
        Insert: {
          account_type: string
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
        }
        Update: {
          account_type?: string
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_name: string | null
          created_at: string
          document_number: string | null
          document_type: string | null
          entity: string
          entity_id: string | null
          id: number
          new_data: Json | null
          old_data: Json | null
          reason: string | null
          source_id: string | null
          source_type: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          actor_name?: string | null
          created_at?: string
          document_number?: string | null
          document_type?: string | null
          entity: string
          entity_id?: string | null
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          reason?: string | null
          source_id?: string | null
          source_type?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          actor_name?: string | null
          created_at?: string
          document_number?: string | null
          document_type?: string | null
          entity?: string
          entity_id?: string | null
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          reason?: string | null
          source_id?: string | null
          source_type?: string | null
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
          finance_settings: Json
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
          finance_settings?: Json
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
          finance_settings?: Json
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
      director_approval_votes: {
        Row: {
          actor_id: string
          comment: string | null
          created_at: string
          decision: string
          entity_id: string
          entity_type: string
          id: string
        }
        Insert: {
          actor_id: string
          comment?: string | null
          created_at?: string
          decision: string
          entity_id: string
          entity_type: string
          id?: string
        }
        Update: {
          actor_id?: string
          comment?: string | null
          created_at?: string
          decision?: string
          entity_id?: string
          entity_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "director_approval_votes_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_number_counters: {
        Row: {
          doc: string
          last_value: number
          year: number
        }
        Insert: {
          doc: string
          last_value?: number
          year: number
        }
        Update: {
          doc?: string
          last_value?: number
          year?: number
        }
        Relationships: []
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
      goods_receipt_items: {
        Row: {
          accepted_quantity: number
          challan_item_id: string | null
          damaged_quantity: number
          disposition: Database["public"]["Enums"]["grn_disposition"]
          disposition_at: string | null
          disposition_by: string | null
          disposition_reason: string | null
          grn_id: string
          id: string
          material_id: string
          ordered_quantity: number
          po_item_id: string
          previously_received: number
          received_quantity: number
          rejected_quantity: number
          remarks: string | null
          short_closed_quantity: number
          unit_cost: number
          unit_id: string
        }
        Insert: {
          accepted_quantity: number
          challan_item_id?: string | null
          damaged_quantity?: number
          disposition?: Database["public"]["Enums"]["grn_disposition"]
          disposition_at?: string | null
          disposition_by?: string | null
          disposition_reason?: string | null
          grn_id: string
          id?: string
          material_id: string
          ordered_quantity: number
          po_item_id: string
          previously_received: number
          received_quantity: number
          rejected_quantity?: number
          remarks?: string | null
          short_closed_quantity?: number
          unit_cost: number
          unit_id: string
        }
        Update: {
          accepted_quantity?: number
          challan_item_id?: string | null
          damaged_quantity?: number
          disposition?: Database["public"]["Enums"]["grn_disposition"]
          disposition_at?: string | null
          disposition_by?: string | null
          disposition_reason?: string | null
          grn_id?: string
          id?: string
          material_id?: string
          ordered_quantity?: number
          po_item_id?: string
          previously_received?: number
          received_quantity?: number
          rejected_quantity?: number
          remarks?: string | null
          short_closed_quantity?: number
          unit_cost?: number
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_items_challan_item_fk"
            columns: ["challan_item_id"]
            isOneToOne: false
            referencedRelation: "vendor_delivery_challan_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_items_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_items_po_item_id_fkey"
            columns: ["po_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_notes: {
        Row: {
          building_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          challan_id: string | null
          challan_number: string | null
          company_id: string
          created_at: string
          grn_number: string
          id: string
          invoice_reference: string | null
          po_id: string
          posted_at: string | null
          project_id: string
          purchase_request_id: string | null
          received_by: string
          received_date: string
          remarks: string | null
          rfq_id: string | null
          status: Database["public"]["Enums"]["grn_status"]
          vehicle_number: string | null
          vendor_id: string
          warehouse_id: string
        }
        Insert: {
          building_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          challan_id?: string | null
          challan_number?: string | null
          company_id: string
          created_at?: string
          grn_number: string
          id?: string
          invoice_reference?: string | null
          po_id: string
          posted_at?: string | null
          project_id: string
          purchase_request_id?: string | null
          received_by: string
          received_date?: string
          remarks?: string | null
          rfq_id?: string | null
          status?: Database["public"]["Enums"]["grn_status"]
          vehicle_number?: string | null
          vendor_id: string
          warehouse_id: string
        }
        Update: {
          building_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          challan_id?: string | null
          challan_number?: string | null
          company_id?: string
          created_at?: string
          grn_number?: string
          id?: string
          invoice_reference?: string | null
          po_id?: string
          posted_at?: string | null
          project_id?: string
          purchase_request_id?: string | null
          received_by?: string
          received_date?: string
          remarks?: string | null
          rfq_id?: string | null
          status?: Database["public"]["Enums"]["grn_status"]
          vehicle_number?: string | null
          vendor_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_notes_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_stats"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_challan_id_fkey"
            columns: ["challan_id"]
            isOneToOne: false
            referencedRelation: "vendor_delivery_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transactions: {
        Row: {
          adjustment_id: string | null
          balance_after: number
          building_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          grn_id: string | null
          grn_item_id: string | null
          id: number
          material_id: string
          material_issue_id: string | null
          material_issue_item_id: string | null
          material_return_id: string | null
          material_return_item_id: string | null
          project_id: string | null
          quantity_in: number
          quantity_out: number
          remarks: string | null
          total_cost: number
          transfer_id: string | null
          tx_date: string
          tx_type: Database["public"]["Enums"]["inventory_tx_type"]
          unit_cost: number
          warehouse_id: string
        }
        Insert: {
          adjustment_id?: string | null
          balance_after: number
          building_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          grn_id?: string | null
          grn_item_id?: string | null
          id?: never
          material_id: string
          material_issue_id?: string | null
          material_issue_item_id?: string | null
          material_return_id?: string | null
          material_return_item_id?: string | null
          project_id?: string | null
          quantity_in?: number
          quantity_out?: number
          remarks?: string | null
          total_cost: number
          transfer_id?: string | null
          tx_date?: string
          tx_type: Database["public"]["Enums"]["inventory_tx_type"]
          unit_cost: number
          warehouse_id: string
        }
        Update: {
          adjustment_id?: string | null
          balance_after?: number
          building_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          grn_id?: string | null
          grn_item_id?: string | null
          id?: never
          material_id?: string
          material_issue_id?: string | null
          material_issue_item_id?: string | null
          material_return_id?: string | null
          material_return_item_id?: string | null
          project_id?: string | null
          quantity_in?: number
          quantity_out?: number
          remarks?: string | null
          total_cost?: number
          transfer_id?: string | null
          tx_date?: string
          tx_type?: Database["public"]["Enums"]["inventory_tx_type"]
          unit_cost?: number
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_stats"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "inventory_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_grn_item_id_fkey"
            columns: ["grn_item_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_material_issue_id_fkey"
            columns: ["material_issue_id"]
            isOneToOne: false
            referencedRelation: "material_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_material_issue_item_id_fkey"
            columns: ["material_issue_item_id"]
            isOneToOne: false
            referencedRelation: "material_issue_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_material_return_id_fkey"
            columns: ["material_return_id"]
            isOneToOne: false
            referencedRelation: "material_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_material_return_item_id_fkey"
            columns: ["material_return_item_id"]
            isOneToOne: false
            referencedRelation: "material_return_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_match_runs: {
        Row: {
          exceptions: Json
          id: string
          invoice_id: string
          qty_tolerance_pct: number
          rate_tolerance_pct: number
          result: Database["public"]["Enums"]["match_status"]
          run_at: string
          run_by: string | null
          summary: Json | null
          value_tolerance: number
        }
        Insert: {
          exceptions?: Json
          id?: string
          invoice_id: string
          qty_tolerance_pct: number
          rate_tolerance_pct: number
          result: Database["public"]["Enums"]["match_status"]
          run_at?: string
          run_by?: string | null
          summary?: Json | null
          value_tolerance: number
        }
        Update: {
          exceptions?: Json
          id?: string
          invoice_id?: string
          qty_tolerance_pct?: number
          rate_tolerance_pct?: number
          result?: Database["public"]["Enums"]["match_status"]
          run_at?: string
          run_by?: string | null
          summary?: Json | null
          value_tolerance?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_match_runs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "vendor_invoices"
            referencedColumns: ["id"]
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
      journal_entries: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          entry_date: string
          entry_number: string
          id: string
          narration: string | null
          project_id: string | null
          source_id: string
          source_type: string
          vendor_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          entry_date: string
          entry_number: string
          id?: string
          narration?: string | null
          project_id?: string | null
          source_id: string
          source_type: string
          vendor_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          entry_number?: string
          id?: string
          narration?: string | null
          project_id?: string | null
          source_id?: string
          source_type?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          credit: number
          debit: number
          entry_id: string
          id: number
        }
        Insert: {
          account_id: string
          credit?: number
          debit?: number
          entry_id: string
          id?: never
        }
        Update: {
          account_id?: string
          credit?: number
          debit?: number
          entry_id?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      material_issue_items: {
        Row: {
          id: string
          issue_id: string
          material_id: string
          quantity: number
          total_cost: number
          unit_cost: number
        }
        Insert: {
          id?: string
          issue_id: string
          material_id: string
          quantity: number
          total_cost: number
          unit_cost: number
        }
        Update: {
          id?: string
          issue_id?: string
          material_id?: string
          quantity?: number
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "material_issue_items_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "material_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_issue_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      material_issues: {
        Row: {
          building_id: string | null
          company_id: string
          created_at: string
          created_by: string
          id: string
          issue_date: string
          issue_number: string
          issued_to: string
          project_id: string
          purpose: string
          warehouse_id: string
        }
        Insert: {
          building_id?: string | null
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          issue_date?: string
          issue_number: string
          issued_to: string
          project_id: string
          purpose: string
          warehouse_id: string
        }
        Update: {
          building_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          issue_date?: string
          issue_number?: string
          issued_to?: string
          project_id?: string
          purpose?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_issues_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_issues_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_stats"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "material_issues_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_issues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_issues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_issues_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      material_return_items: {
        Row: {
          id: string
          issue_item_id: string
          material_id: string
          quantity: number
          return_id: string
          total_cost: number
          unit_cost: number
        }
        Insert: {
          id?: string
          issue_item_id: string
          material_id: string
          quantity: number
          return_id: string
          total_cost: number
          unit_cost: number
        }
        Update: {
          id?: string
          issue_item_id?: string
          material_id?: string
          quantity?: number
          return_id?: string
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "material_return_items_issue_item_id_fkey"
            columns: ["issue_item_id"]
            isOneToOne: false
            referencedRelation: "material_issue_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_return_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "material_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      material_returns: {
        Row: {
          building_id: string | null
          company_id: string
          created_at: string
          created_by: string
          id: string
          issue_id: string
          project_id: string
          reason: string
          return_date: string
          return_number: string
          returned_by: string
          warehouse_id: string
        }
        Insert: {
          building_id?: string | null
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          issue_id: string
          project_id: string
          reason: string
          return_date?: string
          return_number: string
          returned_by: string
          warehouse_id: string
        }
        Update: {
          building_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          issue_id?: string
          project_id?: string
          reason?: string
          return_date?: string
          return_number?: string
          returned_by?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_returns_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_returns_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_stats"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "material_returns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_returns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_returns_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "material_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_returns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_returns_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
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
      purchase_order_approvals: {
        Row: {
          acted_at: string
          acted_by: string | null
          action: Database["public"]["Enums"]["po_action"]
          comment: string | null
          id: string
          new_status: Database["public"]["Enums"]["po_status"] | null
          po_id: string
          previous_status: Database["public"]["Enums"]["po_status"] | null
        }
        Insert: {
          acted_at?: string
          acted_by?: string | null
          action: Database["public"]["Enums"]["po_action"]
          comment?: string | null
          id?: string
          new_status?: Database["public"]["Enums"]["po_status"] | null
          po_id: string
          previous_status?: Database["public"]["Enums"]["po_status"] | null
        }
        Update: {
          acted_at?: string
          acted_by?: string | null
          action?: Database["public"]["Enums"]["po_action"]
          comment?: string | null
          id?: string
          new_status?: Database["public"]["Enums"]["po_status"] | null
          po_id?: string
          previous_status?: Database["public"]["Enums"]["po_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_approvals_acted_by_fkey"
            columns: ["acted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_approvals_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          accepted_quantity: number
          description: string | null
          discount_amount: number
          id: string
          line_no: number
          line_total: number
          material_id: string
          ordered_quantity: number
          po_id: string
          quotation_item_id: string
          rate: number
          received_quantity: number
          rfq_item_id: string
          short_close_reason: string | null
          short_closed_quantity: number
          tax_amount: number
          tax_rate_percent: number
          tax_type: string
          taxable_amount: number
          unit_id: string
          vendor_selection_id: string
        }
        Insert: {
          accepted_quantity?: number
          description?: string | null
          discount_amount?: number
          id?: string
          line_no: number
          line_total: number
          material_id: string
          ordered_quantity: number
          po_id: string
          quotation_item_id: string
          rate: number
          received_quantity?: number
          rfq_item_id: string
          short_close_reason?: string | null
          short_closed_quantity?: number
          tax_amount: number
          tax_rate_percent: number
          tax_type: string
          taxable_amount: number
          unit_id: string
          vendor_selection_id: string
        }
        Update: {
          accepted_quantity?: number
          description?: string | null
          discount_amount?: number
          id?: string
          line_no?: number
          line_total?: number
          material_id?: string
          ordered_quantity?: number
          po_id?: string
          quotation_item_id?: string
          rate?: number
          received_quantity?: number
          rfq_item_id?: string
          short_close_reason?: string | null
          short_closed_quantity?: number
          tax_amount?: number
          tax_rate_percent?: number
          tax_type?: string
          taxable_amount?: number
          unit_id?: string
          vendor_selection_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_quotation_item_id_fkey"
            columns: ["quotation_item_id"]
            isOneToOne: false
            referencedRelation: "vendor_quotation_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_rfq_item_id_fkey"
            columns: ["rfq_item_id"]
            isOneToOne: false
            referencedRelation: "rfq_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_vendor_selection_id_fkey"
            columns: ["vendor_selection_id"]
            isOneToOne: true
            referencedRelation: "vendor_selections"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          building_id: string | null
          company_id: string
          created_at: string
          created_by: string
          delivery_terms: string | null
          delivery_warehouse_id: string | null
          discount_total: number
          expected_delivery_date: string | null
          freight: number
          grand_total: number
          id: string
          other_charges: number
          payment_terms: string | null
          po_date: string
          po_number: string
          project_id: string
          purchase_request_id: string
          quotation_id: string
          remarks: string | null
          rfq_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["po_status"]
          subtotal: number
          tax_total: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          building_id?: string | null
          company_id: string
          created_at?: string
          created_by: string
          delivery_terms?: string | null
          delivery_warehouse_id?: string | null
          discount_total?: number
          expected_delivery_date?: string | null
          freight?: number
          grand_total?: number
          id?: string
          other_charges?: number
          payment_terms?: string | null
          po_date?: string
          po_number: string
          project_id: string
          purchase_request_id: string
          quotation_id: string
          remarks?: string | null
          rfq_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          subtotal?: number
          tax_total?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          building_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          delivery_terms?: string | null
          delivery_warehouse_id?: string | null
          discount_total?: number
          expected_delivery_date?: string | null
          freight?: number
          grand_total?: number
          id?: string
          other_charges?: number
          payment_terms?: string | null
          po_date?: string
          po_number?: string
          project_id?: string
          purchase_request_id?: string
          quotation_id?: string
          remarks?: string | null
          rfq_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          subtotal?: number
          tax_total?: number
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_stats"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "purchase_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_delivery_warehouse_id_fkey"
            columns: ["delivery_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: true
            referencedRelation: "vendor_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
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
      rfq_items: {
        Row: {
          created_at: string
          description: string | null
          id: string
          line_no: number
          material_id: string
          pr_item_id: string | null
          requested_quantity: number
          required_by: string | null
          rfq_id: string
          target_rate: number | null
          unit_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          line_no: number
          material_id: string
          pr_item_id?: string | null
          requested_quantity: number
          required_by?: string | null
          rfq_id: string
          target_rate?: number | null
          unit_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          line_no?: number
          material_id?: string
          pr_item_id?: string | null
          requested_quantity?: number
          required_by?: string | null
          rfq_id?: string
          target_rate?: number | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfq_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_items_pr_item_id_fkey"
            columns: ["pr_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_request_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_items_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      rfq_number_counters: {
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
      rfq_vendors: {
        Row: {
          id: string
          invited_at: string
          remarks: string | null
          responded_at: string | null
          rfq_id: string
          status: Database["public"]["Enums"]["rfq_vendor_status"]
          vendor_id: string
        }
        Insert: {
          id?: string
          invited_at?: string
          remarks?: string | null
          responded_at?: string | null
          rfq_id: string
          status?: Database["public"]["Enums"]["rfq_vendor_status"]
          vendor_id: string
        }
        Update: {
          id?: string
          invited_at?: string
          remarks?: string | null
          responded_at?: string | null
          rfq_id?: string
          status?: Database["public"]["Enums"]["rfq_vendor_status"]
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfq_vendors_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_vendors_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      rfqs: {
        Row: {
          building_id: string | null
          company_id: string
          created_at: string
          created_by: string
          id: string
          project_id: string
          purchase_request_id: string
          remarks: string | null
          required_by_date: string | null
          response_due_date: string
          rfq_date: string
          rfq_number: string
          selection_reason: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["rfq_status"]
          updated_at: string
        }
        Insert: {
          building_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string
          id?: string
          project_id: string
          purchase_request_id: string
          remarks?: string | null
          required_by_date?: string | null
          response_due_date: string
          rfq_date?: string
          rfq_number?: string
          selection_reason?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["rfq_status"]
          updated_at?: string
        }
        Update: {
          building_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          project_id?: string
          purchase_request_id?: string
          remarks?: string | null
          required_by_date?: string | null
          response_due_date?: string
          rfq_date?: string
          rfq_number?: string
          selection_reason?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["rfq_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfqs_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_stats"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "rfqs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
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
      stock_adjustment_items: {
        Row: {
          adjustment_id: string
          difference: number
          id: string
          material_id: string
          physical_quantity: number
          system_quantity: number
          unit_cost: number
        }
        Insert: {
          adjustment_id: string
          difference: number
          id?: string
          material_id: string
          physical_quantity?: number
          system_quantity?: number
          unit_cost?: number
        }
        Update: {
          adjustment_id?: string
          difference?: number
          id?: string
          material_id?: string
          physical_quantity?: number
          system_quantity?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustment_items_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          adjustment_date: string
          adjustment_number: string
          company_id: string
          created_at: string
          created_by: string
          id: string
          kind: Database["public"]["Enums"]["adjustment_kind"]
          reason: string
          warehouse_id: string
        }
        Insert: {
          adjustment_date?: string
          adjustment_number: string
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          kind: Database["public"]["Enums"]["adjustment_kind"]
          reason: string
          warehouse_id: string
        }
        Update: {
          adjustment_date?: string
          adjustment_number?: string
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          kind?: Database["public"]["Enums"]["adjustment_kind"]
          reason?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfer_items: {
        Row: {
          id: string
          material_id: string
          quantity: number
          transfer_id: string
          unit_cost: number
        }
        Insert: {
          id?: string
          material_id: string
          quantity: number
          transfer_id: string
          unit_cost: number
        }
        Update: {
          id?: string
          material_id?: string
          quantity?: number
          transfer_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_items_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          from_warehouse_id: string
          id: string
          reason: string
          to_warehouse_id: string
          transfer_date: string
          transfer_number: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          from_warehouse_id: string
          id?: string
          reason: string
          to_warehouse_id: string
          transfer_date?: string
          transfer_number: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          from_warehouse_id?: string
          id?: string
          reason?: string
          to_warehouse_id?: string
          transfer_date?: string
          transfer_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_from_warehouse_id_fkey"
            columns: ["from_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_warehouse_id_fkey"
            columns: ["to_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
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
      vendor_advance_adjustments: {
        Row: {
          advance_payment_id: string
          amount: number
          created_at: string
          created_by: string
          id: string
          invoice_id: string
        }
        Insert: {
          advance_payment_id: string
          amount: number
          created_at?: string
          created_by: string
          id?: string
          invoice_id: string
        }
        Update: {
          advance_payment_id?: string
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          invoice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_advance_adjustments_advance_payment_id_fkey"
            columns: ["advance_payment_id"]
            isOneToOne: false
            referencedRelation: "vendor_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_advance_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_advance_adjustments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "vendor_invoices"
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
      vendor_delivery_challan_items: {
        Row: {
          challan_id: string
          id: string
          po_item_id: string
          quantity: number
        }
        Insert: {
          challan_id: string
          id?: string
          po_item_id: string
          quantity: number
        }
        Update: {
          challan_id?: string
          id?: string
          po_item_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "vendor_delivery_challan_items_challan_id_fkey"
            columns: ["challan_id"]
            isOneToOne: false
            referencedRelation: "vendor_delivery_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_delivery_challan_items_po_item_id_fkey"
            columns: ["po_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_delivery_challans: {
        Row: {
          building_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          challan_date: string
          challan_number: string
          company_id: string
          created_at: string
          created_by: string
          id: string
          invoice_reference: string | null
          po_id: string
          project_id: string
          remarks: string | null
          status: string
          vehicle_number: string | null
          vendor_id: string
        }
        Insert: {
          building_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          challan_date: string
          challan_number: string
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          invoice_reference?: string | null
          po_id: string
          project_id: string
          remarks?: string | null
          status?: string
          vehicle_number?: string | null
          vendor_id: string
        }
        Update: {
          building_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          challan_date?: string
          challan_number?: string
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          invoice_reference?: string | null
          po_id?: string
          project_id?: string
          remarks?: string | null
          status?: string
          vehicle_number?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_delivery_challans_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_delivery_challans_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_stats"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "vendor_delivery_challans_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_delivery_challans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_delivery_challans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_delivery_challans_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_delivery_challans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_delivery_challans_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_invoice_events: {
        Row: {
          acted_at: string
          acted_by: string | null
          action: string
          comment: string | null
          id: string
          invoice_id: string
          new_status: Database["public"]["Enums"]["invoice_status"] | null
          previous_status: Database["public"]["Enums"]["invoice_status"] | null
        }
        Insert: {
          acted_at?: string
          acted_by?: string | null
          action: string
          comment?: string | null
          id?: string
          invoice_id: string
          new_status?: Database["public"]["Enums"]["invoice_status"] | null
          previous_status?: Database["public"]["Enums"]["invoice_status"] | null
        }
        Update: {
          acted_at?: string
          acted_by?: string | null
          action?: string
          comment?: string | null
          id?: string
          invoice_id?: string
          new_status?: Database["public"]["Enums"]["invoice_status"] | null
          previous_status?: Database["public"]["Enums"]["invoice_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_invoice_events_acted_by_fkey"
            columns: ["acted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoice_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "vendor_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_invoice_items: {
        Row: {
          available_quantity: number
          grn_id: string
          grn_item_id: string
          id: string
          invoice_id: string
          line_no: number
          line_total: number
          match_ok: boolean | null
          material_id: string
          po_item_id: string
          po_rate: number
          po_tax_rate: number
          qty_variance: number
          quantity: number
          rate: number
          rate_variance: number
          tax_amount: number
          tax_rate_percent: number
          tax_type: string
          tax_variance: number
          taxable_amount: number
        }
        Insert: {
          available_quantity?: number
          grn_id: string
          grn_item_id: string
          id?: string
          invoice_id: string
          line_no: number
          line_total?: number
          match_ok?: boolean | null
          material_id: string
          po_item_id: string
          po_rate?: number
          po_tax_rate?: number
          qty_variance?: number
          quantity: number
          rate: number
          rate_variance?: number
          tax_amount?: number
          tax_rate_percent?: number
          tax_type?: string
          tax_variance?: number
          taxable_amount?: number
        }
        Update: {
          available_quantity?: number
          grn_id?: string
          grn_item_id?: string
          id?: string
          invoice_id?: string
          line_no?: number
          line_total?: number
          match_ok?: boolean | null
          material_id?: string
          po_item_id?: string
          po_rate?: number
          po_tax_rate?: number
          qty_variance?: number
          quantity?: number
          rate?: number
          rate_variance?: number
          tax_amount?: number
          tax_rate_percent?: number
          tax_type?: string
          tax_variance?: number
          taxable_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "vendor_invoice_items_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoice_items_grn_item_id_fkey"
            columns: ["grn_item_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "vendor_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoice_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoice_items_po_item_id_fkey"
            columns: ["po_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_invoices: {
        Row: {
          advance_adjusted: number
          amount_paid: number
          approved_at: string | null
          approved_by: string | null
          attachment_path: string | null
          balance_due: number
          building_id: string | null
          cgst: number
          company_id: string
          created_at: string
          created_by: string
          due_date: string | null
          freight: number
          grand_total: number
          id: string
          igst: number
          invoice_number: string
          match_status: Database["public"]["Enums"]["match_status"]
          match_summary: Json | null
          match_tolerances: Json | null
          matched_at: string | null
          net_payable: number
          other_charges: number
          po_id: string
          project_id: string
          remarks: string | null
          sgst: number
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax_total: number
          tds_amount: number
          tds_rate: number
          tds_section: string | null
          updated_at: string
          vendor_id: string
          vendor_invoice_date: string
          vendor_invoice_number: string
        }
        Insert: {
          advance_adjusted?: number
          amount_paid?: number
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          balance_due?: number
          building_id?: string | null
          cgst?: number
          company_id: string
          created_at?: string
          created_by: string
          due_date?: string | null
          freight?: number
          grand_total?: number
          id?: string
          igst?: number
          invoice_number: string
          match_status?: Database["public"]["Enums"]["match_status"]
          match_summary?: Json | null
          match_tolerances?: Json | null
          matched_at?: string | null
          net_payable?: number
          other_charges?: number
          po_id: string
          project_id: string
          remarks?: string | null
          sgst?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_total?: number
          tds_amount?: number
          tds_rate?: number
          tds_section?: string | null
          updated_at?: string
          vendor_id: string
          vendor_invoice_date: string
          vendor_invoice_number: string
        }
        Update: {
          advance_adjusted?: number
          amount_paid?: number
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          balance_due?: number
          building_id?: string | null
          cgst?: number
          company_id?: string
          created_at?: string
          created_by?: string
          due_date?: string | null
          freight?: number
          grand_total?: number
          id?: string
          igst?: number
          invoice_number?: string
          match_status?: Database["public"]["Enums"]["match_status"]
          match_summary?: Json | null
          match_tolerances?: Json | null
          matched_at?: string | null
          net_payable?: number
          other_charges?: number
          po_id?: string
          project_id?: string
          remarks?: string | null
          sgst?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_total?: number
          tds_amount?: number
          tds_rate?: number
          tds_section?: string | null
          updated_at?: string
          vendor_id?: string
          vendor_invoice_date?: string
          vendor_invoice_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_invoices_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_stats"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "vendor_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_payment_allocations: {
        Row: {
          amount: number
          id: string
          invoice_id: string
          payment_id: string
        }
        Insert: {
          amount: number
          id?: string
          invoice_id: string
          payment_id: string
        }
        Update: {
          amount?: number
          id?: string
          invoice_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "vendor_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "vendor_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_payment_events: {
        Row: {
          acted_at: string
          acted_by: string | null
          action: string
          comment: string | null
          id: string
          new_status: Database["public"]["Enums"]["payment_status"] | null
          payment_id: string
          previous_status: Database["public"]["Enums"]["payment_status"] | null
        }
        Insert: {
          acted_at?: string
          acted_by?: string | null
          action: string
          comment?: string | null
          id?: string
          new_status?: Database["public"]["Enums"]["payment_status"] | null
          payment_id: string
          previous_status?: Database["public"]["Enums"]["payment_status"] | null
        }
        Update: {
          acted_at?: string
          acted_by?: string | null
          action?: string
          comment?: string | null
          id?: string
          new_status?: Database["public"]["Enums"]["payment_status"] | null
          payment_id?: string
          previous_status?: Database["public"]["Enums"]["payment_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_payment_events_acted_by_fkey"
            columns: ["acted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "vendor_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_payments: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          bank_account_id: string | null
          company_id: string
          created_at: string
          created_by: string
          id: string
          kind: Database["public"]["Enums"]["payment_kind"]
          payment_date: string
          payment_mode: string
          payment_number: string
          project_id: string | null
          proof_path: string | null
          recorded_at: string | null
          recorded_by: string | null
          reference: string | null
          remarks: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
          vendor_id: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          bank_account_id?: string | null
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          kind: Database["public"]["Enums"]["payment_kind"]
          payment_date: string
          payment_mode: string
          payment_number: string
          project_id?: string | null
          proof_path?: string | null
          recorded_at?: string | null
          recorded_by?: string | null
          reference?: string | null
          remarks?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          vendor_id: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          bank_account_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          kind?: Database["public"]["Enums"]["payment_kind"]
          payment_date?: string
          payment_mode?: string
          payment_number?: string
          project_id?: string | null
          proof_path?: string | null
          recorded_at?: string | null
          recorded_by?: string | null
          reference?: string | null
          remarks?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_payments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "company_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_quotation_items: {
        Row: {
          delivery_days: number | null
          discount_amount: number
          id: string
          is_quoted: boolean
          line_total: number
          quotation_id: string
          quoted_quantity: number
          rate: number
          remarks: string | null
          rfq_item_id: string
          tax_amount: number
          tax_rate_percent: number
          tax_type: string
          taxable_amount: number
        }
        Insert: {
          delivery_days?: number | null
          discount_amount?: number
          id?: string
          is_quoted?: boolean
          line_total?: number
          quotation_id: string
          quoted_quantity?: number
          rate?: number
          remarks?: string | null
          rfq_item_id: string
          tax_amount?: number
          tax_rate_percent?: number
          tax_type?: string
          taxable_amount?: number
        }
        Update: {
          delivery_days?: number | null
          discount_amount?: number
          id?: string
          is_quoted?: boolean
          line_total?: number
          quotation_id?: string
          quoted_quantity?: number
          rate?: number
          remarks?: string | null
          rfq_item_id?: string
          tax_amount?: number
          tax_rate_percent?: number
          tax_type?: string
          taxable_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "vendor_quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "vendor_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_quotation_items_rfq_item_id_fkey"
            columns: ["rfq_item_id"]
            isOneToOne: false
            referencedRelation: "rfq_items"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_quotations: {
        Row: {
          attachment_path: string | null
          created_at: string
          created_by: string | null
          delivery_days: number | null
          discount_total: number
          freight: number
          grand_total: number
          id: string
          other_charges: number
          payment_terms: string | null
          quotation_date: string
          quotation_number: string
          remarks: string | null
          rfq_id: string
          rfq_vendor_id: string
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          tax_total: number
          updated_at: string
          valid_until: string | null
          vendor_id: string
        }
        Insert: {
          attachment_path?: string | null
          created_at?: string
          created_by?: string | null
          delivery_days?: number | null
          discount_total?: number
          freight?: number
          grand_total?: number
          id?: string
          other_charges?: number
          payment_terms?: string | null
          quotation_date?: string
          quotation_number: string
          remarks?: string | null
          rfq_id: string
          rfq_vendor_id: string
          status?: Database["public"]["Enums"]["quotation_status"]
          subtotal?: number
          tax_total?: number
          updated_at?: string
          valid_until?: string | null
          vendor_id: string
        }
        Update: {
          attachment_path?: string | null
          created_at?: string
          created_by?: string | null
          delivery_days?: number | null
          discount_total?: number
          freight?: number
          grand_total?: number
          id?: string
          other_charges?: number
          payment_terms?: string | null
          quotation_date?: string
          quotation_number?: string
          remarks?: string | null
          rfq_id?: string
          rfq_vendor_id?: string
          status?: Database["public"]["Enums"]["quotation_status"]
          subtotal?: number
          tax_total?: number
          updated_at?: string
          valid_until?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_quotations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_quotations_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_quotations_rfq_vendor_id_fkey"
            columns: ["rfq_vendor_id"]
            isOneToOne: true
            referencedRelation: "rfq_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_quotations_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_selections: {
        Row: {
          awarded_rate: number
          id: string
          quotation_id: string
          quotation_item_id: string
          reason: string | null
          rfq_id: string
          rfq_item_id: string
          selected_at: string
          selected_by: string | null
          selected_quantity: number
          vendor_id: string
        }
        Insert: {
          awarded_rate: number
          id?: string
          quotation_id: string
          quotation_item_id: string
          reason?: string | null
          rfq_id: string
          rfq_item_id: string
          selected_at?: string
          selected_by?: string | null
          selected_quantity: number
          vendor_id: string
        }
        Update: {
          awarded_rate?: number
          id?: string
          quotation_id?: string
          quotation_item_id?: string
          reason?: string | null
          rfq_id?: string
          rfq_item_id?: string
          selected_at?: string
          selected_by?: string | null
          selected_quantity?: number
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_selections_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "vendor_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_selections_quotation_item_id_fkey"
            columns: ["quotation_item_id"]
            isOneToOne: false
            referencedRelation: "vendor_quotation_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_selections_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_selections_rfq_item_id_fkey"
            columns: ["rfq_item_id"]
            isOneToOne: true
            referencedRelation: "rfq_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_selections_selected_by_fkey"
            columns: ["selected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_selections_vendor_id_fkey"
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
      warehouse_stock: {
        Row: {
          material_id: string
          quantity_on_hand: number
          total_value: number
          updated_at: string
          warehouse_id: string
          weighted_avg_cost: number
        }
        Insert: {
          material_id: string
          quantity_on_hand?: number
          total_value?: number
          updated_at?: string
          warehouse_id: string
          weighted_avg_cost?: number
        }
        Update: {
          material_id?: string
          quantity_on_hand?: number
          total_value?: number
          updated_at?: string
          warehouse_id?: string
          weighted_avg_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_stock_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_stock_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
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
      acct: { Args: { _code: string; _company: string }; Returns: string }
      apply_vendor_advance: {
        Args: { _advance_id: string; _amount: number; _invoice_id: string }
        Returns: undefined
      }
      can_access_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      cancel_goods_receipt: {
        Args: { _grn_id: string; _reason: string }
        Returns: undefined
      }
      cancel_vendor_delivery_challan: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      create_goods_receipt: {
        Args: {
          _header: Json
          _items: Json
          _po_id: string
          _post?: boolean
          _warehouse_id: string
        }
        Returns: string
      }
      create_po_from_selection: {
        Args: { _quotation_id: string; _rfq_id: string }
        Returns: string
      }
      create_stock_adjustment: {
        Args: {
          _items: Json
          _kind: Database["public"]["Enums"]["adjustment_kind"]
          _reason: string
          _warehouse_id: string
        }
        Returns: string
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
      execute_stock_transfer: {
        Args: { _from: string; _items: Json; _reason: string; _to: string }
        Returns: string
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
      grn_apply: { Args: { _grn_id: string }; Returns: undefined }
      grn_item_available: {
        Args: { _exclude_invoice: string; _grn_item: string }
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
      invoice_transition: {
        Args: { _action: string; _comment: string; _id: string }
        Returns: Database["public"]["Enums"]["invoice_status"]
      }
      is_active_user: { Args: { _user_id: string }; Returns: boolean }
      ist_today: { Args: never; Returns: string }
      log_event: {
        Args: {
          _action: string
          _doc_number: string
          _doc_type: string
          _new: Json
          _old: Json
          _reason: string
          _record_id: string
          _source_id?: string
          _source_type?: string
        }
        Returns: undefined
      }
      my_permissions: { Args: never; Returns: string[] }
      next_doc_number: {
        Args: { _doc: string; _prefix: string }
        Returns: string
      }
      next_fy_doc_number: {
        Args: { _doc: string; _prefix: string }
        Returns: string
      }
      norm_bill_no: { Args: { _t: string }; Returns: string }
      payment_transition: {
        Args: { _action: string; _comment: string; _details: Json; _id: string }
        Returns: Database["public"]["Enums"]["payment_status"]
      }
      po_can_view: { Args: { _po_id: string }; Returns: boolean }
      po_refresh_status: {
        Args: { _po: string }
        Returns: Database["public"]["Enums"]["po_status"]
      }
      po_transition: {
        Args: {
          _action: Database["public"]["Enums"]["po_action"]
          _comment: string
          _po_id: string
        }
        Returns: Database["public"]["Enums"]["po_status"]
      }
      post_goods_receipt: { Args: { _grn_id: string }; Returns: undefined }
      post_journal: {
        Args: {
          _company: string
          _date: string
          _lines: Json
          _narr: string
          _project: string
          _src: string
          _src_id: string
          _vendor: string
        }
        Returns: string
      }
      post_material_stock: {
        Args: {
          _building: string
          _company: string
          _document_value: number
          _issue: string
          _issue_item: string
          _kind: string
          _material: string
          _project: string
          _qty: number
          _return: string
          _return_item: string
          _source_cost: number
          _warehouse: string
        }
        Returns: number
      }
      post_stock: {
        Args: {
          _company: string
          _cost: number
          _grn: string
          _grn_item: string
          _mat: string
          _project: string
          _qin: number
          _qout: number
          _remarks: string
          _transfer: string
          _type: Database["public"]["Enums"]["inventory_tx_type"]
          _wh: string
        }
        Returns: number
      }
      post_stock_x: {
        Args: {
          _adjustment: string
          _building: string
          _company: string
          _cost: number
          _grn: string
          _grn_item: string
          _mat: string
          _project: string
          _qin: number
          _qout: number
          _remarks: string
          _transfer: string
          _type: Database["public"]["Enums"]["inventory_tx_type"]
          _wh: string
        }
        Returns: number
      }
      pr_transition: {
        Args: {
          _action: Database["public"]["Enums"]["pr_action"]
          _comment?: string
          _pr_id: string
        }
        Returns: Database["public"]["Enums"]["pr_status"]
      }
      project_material_consumption: {
        Args: { _project_id?: string }
        Returns: {
          building_id: string
          building_name: string
          issued_quantity: number
          issued_value: number
          material_code: string
          material_id: string
          material_name: string
          net_quantity: number
          net_value: number
          project_id: string
          project_name: string
          returned_quantity: number
          returned_value: number
          unit_code: string
        }[]
      }
      record_material_issue: {
        Args: {
          _building_id: string
          _issued_to: string
          _items: Json
          _project_id: string
          _purpose: string
          _warehouse_id: string
        }
        Returns: string
      }
      record_material_return: {
        Args: {
          _issue_id: string
          _items: Json
          _reason: string
          _returned_by: string
        }
        Returns: string
      }
      record_vendor_selection: {
        Args: { _reason: string; _rfq_id: string; _selections: Json }
        Returns: number
      }
      register_director_vote: {
        Args: {
          _comment: string
          _decision: string
          _id: string
          _type: string
        }
        Returns: number
      }
      register_vendor_delivery_challan: {
        Args: { _header: Json; _items: Json; _po_id: string }
        Returns: string
      }
      rfq_can_edit_draft: { Args: { _rfq_id: string }; Returns: boolean }
      rfq_can_quote: { Args: { _rfq_id: string }; Returns: boolean }
      rfq_can_view: { Args: { _rfq_id: string }; Returns: boolean }
      rfq_mark_vendor_declined: {
        Args: { _remarks?: string; _rfq_vendor_id: string }
        Returns: undefined
      }
      rfq_transition: {
        Args: { _action: string; _comment?: string; _rfq_id: string }
        Returns: Database["public"]["Enums"]["rfq_status"]
      }
      run_invoice_match: {
        Args: { _id: string }
        Returns: Database["public"]["Enums"]["match_status"]
      }
      save_vendor_invoice: {
        Args: { _header: Json; _id: string; _items: Json }
        Returns: string
      }
      schedule_vendor_payment: {
        Args: { _allocations: Json; _header: Json }
        Returns: string
      }
      set_grn_disposition: {
        Args: {
          _disposition: Database["public"]["Enums"]["grn_disposition"]
          _grn_item: string
          _reason: string
        }
        Returns: undefined
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
      short_close_po_line: {
        Args: { _po_item: string; _qty: number; _reason: string }
        Returns: undefined
      }
      update_finance_settings: { Args: { _settings: Json }; Returns: undefined }
      vi_can_view: { Args: { _invoice_id: string }; Returns: boolean }
      vi_refresh_balance: { Args: { _id: string }; Returns: undefined }
      vq_recompute: { Args: { _qid: string }; Returns: undefined }
    }
    Enums: {
      adjustment_kind: "adjustment" | "opening_stock"
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
      grn_disposition:
        | "pending_decision"
        | "replacement_expected"
        | "short_close"
        | "return_to_vendor"
        | "credit_note_expected"
        | "accepted_under_concession"
      grn_status: "draft" | "posted" | "cancelled"
      inventory_tx_type:
        | "opening_stock"
        | "goods_receipt"
        | "transfer_in"
        | "transfer_out"
        | "damage"
        | "adjustment"
        | "material_issue"
        | "material_return"
        | "purchase_return"
      invoice_status:
        | "draft"
        | "pending_review"
        | "exception"
        | "approved"
        | "rejected"
        | "partially_paid"
        | "paid"
        | "cancelled"
      match_status: "pending" | "matched" | "exception"
      payment_kind: "invoice" | "advance"
      payment_status: "scheduled" | "approved" | "recorded" | "cancelled"
      po_action:
        | "created"
        | "submitted"
        | "approved"
        | "rejected"
        | "sent"
        | "cancelled"
        | "closed"
      po_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "rejected"
        | "sent"
        | "partially_received"
        | "fully_received"
        | "closed"
        | "cancelled"
        | "partially_accepted"
        | "short_closed"
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
      quotation_status: "draft" | "submitted" | "selected" | "rejected"
      record_status: "active" | "inactive"
      rfq_status:
        | "draft"
        | "sent"
        | "partially_responded"
        | "fully_responded"
        | "ready_for_po"
        | "closed"
        | "cancelled"
      rfq_vendor_status: "pending" | "responded" | "declined"
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
      adjustment_kind: ["adjustment", "opening_stock"],
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
      grn_disposition: [
        "pending_decision",
        "replacement_expected",
        "short_close",
        "return_to_vendor",
        "credit_note_expected",
        "accepted_under_concession",
      ],
      grn_status: ["draft", "posted", "cancelled"],
      inventory_tx_type: [
        "opening_stock",
        "goods_receipt",
        "transfer_in",
        "transfer_out",
        "damage",
        "adjustment",
        "material_issue",
        "material_return",
        "purchase_return",
      ],
      invoice_status: [
        "draft",
        "pending_review",
        "exception",
        "approved",
        "rejected",
        "partially_paid",
        "paid",
        "cancelled",
      ],
      match_status: ["pending", "matched", "exception"],
      payment_kind: ["invoice", "advance"],
      payment_status: ["scheduled", "approved", "recorded", "cancelled"],
      po_action: [
        "created",
        "submitted",
        "approved",
        "rejected",
        "sent",
        "cancelled",
        "closed",
      ],
      po_status: [
        "draft",
        "pending_approval",
        "approved",
        "rejected",
        "sent",
        "partially_received",
        "fully_received",
        "closed",
        "cancelled",
        "partially_accepted",
        "short_closed",
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
      quotation_status: ["draft", "submitted", "selected", "rejected"],
      record_status: ["active", "inactive"],
      rfq_status: [
        "draft",
        "sent",
        "partially_responded",
        "fully_responded",
        "ready_for_po",
        "closed",
        "cancelled",
      ],
      rfq_vendor_status: ["pending", "responded", "declined"],
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
