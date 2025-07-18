import {
  AuthenticationState,
  AuthenticationCreds,
  SignalDataTypeMap,
  initAuthCreds,
  BufferJSON,
} from "@whiskeysockets/baileys";
import { proto } from "@whiskeysockets/baileys/WAProto";
import { supabaseAdmin } from "../lib/supabase";
import logger from "../lib/logger";

/**
 * Supabase-based auth state implementation for production use
 * Stores auth credentials and signal keys in Supabase database
 */
export async function useSupabaseAuthState(
  userId: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  // Load credentials from database
  let creds: AuthenticationCreds;
  try {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_auth_creds")
      .select("creds_data")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 is "not found" error, which is expected for new users
      throw error;
    }

    if (data?.creds_data) {
      creds = JSON.parse(JSON.stringify(data.creds_data), BufferJSON.reviver);
    } else {
      // Initialize new credentials if none exist
      creds = initAuthCreds();
    }
  } catch (error) {
    logger.warn(
      {
        userId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to load credentials, initializing new ones"
    );
    creds = initAuthCreds();
  }

  // Cache for keys to minimize database queries during a session
  const keysCache = new Map<string, any>();
  let keysCacheDirty = false;

  // Save credentials function
  const saveCreds = async () => {
    try {
      const credsData = JSON.parse(JSON.stringify(creds, BufferJSON.replacer));

      // Use upsert with onConflict to handle existing records properly
      const { error } = await supabaseAdmin.from("whatsapp_auth_creds").upsert(
        {
          user_id: userId,
          creds_data: credsData,
        },
        {
          onConflict: "user_id",
        }
      );

      if (error) {
        logger.error(
          {
            userId,
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
              hint: error.hint,
            },
          },
          "Supabase upsert error"
        );
        throw error;
      }

      logger.debug(
        {
          userId,
        },
        "Saved credentials"
      );
    } catch (error) {
      logger.error(
        {
          userId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to save credentials"
      );

      // If it's a duplicate key error, try to update instead
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        logger.debug(
          {
            userId,
          },
          "Attempting to update existing credentials"
        );
        try {
          const credsData = JSON.parse(
            JSON.stringify(creds, BufferJSON.replacer)
          );
          const { error: updateError } = await supabaseAdmin
            .from("whatsapp_auth_creds")
            .update({ creds_data: credsData })
            .eq("user_id", userId);

          if (updateError) {
            throw updateError;
          }

          logger.debug(
            {
              userId,
            },
            "Updated existing credentials"
          );
          return;
        } catch (updateError) {
          logger.error(
            {
              userId,
              error:
                updateError instanceof Error
                  ? updateError.message
                  : String(updateError),
            },
            "Failed to update credentials"
          );
        }
      }

      throw error;
    }
  };

  // Load all keys for user from database into cache
  const loadKeysCache = async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from("whatsapp_auth_keys")
        .select("key_type, key_id, key_data")
        .eq("user_id", userId);

      if (error) {
        throw error;
      }

      keysCache.clear();
      if (data) {
        for (const row of data) {
          const cacheKey = `${row.key_type}:${row.key_id}`;
          keysCache.set(
            cacheKey,
            JSON.parse(JSON.stringify(row.key_data), BufferJSON.reviver)
          );
        }
      }

      keysCacheDirty = false;
      logger.debug(
        {
          userId,
          keyCount: keysCache.size,
        },
        "Loaded keys"
      );
    } catch (error) {
      logger.error(
        {
          userId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to load keys"
      );
      keysCache.clear();
    }
  };

  // Save modified keys to database
  const saveKeys = async () => {
    if (!keysCacheDirty) {
      return; // No changes to save
    }

    try {
      // Get current keys from database to determine what to update/insert/delete
      const { data: existingKeys, error: fetchError } = await supabaseAdmin
        .from("whatsapp_auth_keys")
        .select("key_type, key_id")
        .eq("user_id", userId);

      if (fetchError) {
        throw fetchError;
      }

      const existingKeySet = new Set<string>();
      if (existingKeys) {
        for (const key of existingKeys) {
          existingKeySet.add(`${key.key_type}:${key.key_id}`);
        }
      }

      const currentKeySet = new Set<string>(keysCache.keys());

      // Keys to delete (exist in DB but not in cache)
      const keysToDelete = [...existingKeySet].filter(
        (k) => !currentKeySet.has(k)
      );

      // Keys to upsert (exist in cache)
      const keysToUpsert = [...currentKeySet];

      // Delete removed keys
      if (keysToDelete.length > 0) {
        const deletePromises = keysToDelete.map((cacheKey) => {
          const [keyType, keyId] = cacheKey.split(":", 2);
          return supabaseAdmin
            .from("whatsapp_auth_keys")
            .delete()
            .eq("user_id", userId)
            .eq("key_type", keyType)
            .eq("key_id", keyId);
        });

        await Promise.all(deletePromises);
        logger.debug(
          {
            userId,
            deletedCount: keysToDelete.length,
          },
          "Deleted keys"
        );
      }

      // Upsert current keys
      if (keysToUpsert.length > 0) {
        const upsertData = keysToUpsert.map((cacheKey) => {
          const [keyType, keyId] = cacheKey.split(":", 2);
          const keyData = keysCache.get(cacheKey);
          return {
            user_id: userId,
            key_type: keyType,
            key_id: keyId,
            key_data: JSON.parse(JSON.stringify(keyData, BufferJSON.replacer)),
          };
        });

        // Batch upsert in chunks to avoid payload size limits
        const chunkSize = 100;
        for (let i = 0; i < upsertData.length; i += chunkSize) {
          const chunk = upsertData.slice(i, i + chunkSize);
          const { error } = await supabaseAdmin
            .from("whatsapp_auth_keys")
            .upsert(chunk, {
              onConflict: "user_id,key_type,key_id",
            });

          if (error) {
            throw error;
          }
        }

        logger.debug(
          {
            userId,
            savedCount: keysToUpsert.length,
          },
          "Saved keys"
        );
      }

      keysCacheDirty = false;
    } catch (error) {
      logger.error(
        {
          userId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to save keys"
      );
      throw error;
    }
  };

  // Load initial keys cache
  await loadKeysCache();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data: { [_: string]: SignalDataTypeMap[typeof type] } = {};

        for (const id of ids) {
          const cacheKey = `${type}:${id}`;
          let value = keysCache.get(cacheKey);

          if (type === "app-state-sync-key" && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }

          if (value !== undefined && value !== null) {
            data[id] = value;
          }
        }

        return data;
      },

      set: async (data) => {
        let hasChanges = false;

        for (const category in data) {
          for (const id in data[category as keyof SignalDataTypeMap]) {
            const value = data[category as keyof SignalDataTypeMap]![id];
            const cacheKey = `${category}:${id}`;

            if (value === null || value === undefined) {
              if (keysCache.has(cacheKey)) {
                keysCache.delete(cacheKey);
                hasChanges = true;
              }
            } else {
              keysCache.set(cacheKey, value);
              hasChanges = true;
            }
          }
        }

        if (hasChanges) {
          keysCacheDirty = true;
          // Save immediately to ensure data persistence
          await saveKeys();
        }
      },

      clear: async () => {
        keysCache.clear();
        keysCacheDirty = true;
        await saveKeys();
        logger.debug(
          {
            userId,
          },
          "Cleared all keys"
        );
      },
    },
  };

  return { state, saveCreds };
}
