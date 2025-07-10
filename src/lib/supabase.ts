import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY"
  );
}

if (!supabaseServiceRoleKey) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
}

// Create Supabase client with anon key - will use user JWT tokens for RLS
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Service role client for backend operations (bypasses RLS)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Function to create authenticated Supabase client with user token
export const createAuthenticatedSupabaseClient = (userToken: string) => {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    },
  });
};

// Database types
export interface WhatsAppMessage {
  id?: string;
  user_id: string;
  timestamp: string;
  group_id: string;
  group_name: string;
  sender: string;
  message: any;
  created_at?: string;
}

export interface WhatsAppAuth {
  user_id: string;
  creds: any;
  created_at?: string;
  updated_at?: string;
}

export interface WhatsAppKeys {
  user_id: string;
  key_type: string;
  key_id: string;
  key_data: any;
  created_at?: string;
  updated_at?: string;
}
