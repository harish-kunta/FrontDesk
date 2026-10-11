import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// Auth.js owns identity records. The app-specific tables below attach identity
// to a workspace and keep customer data tenant-scoped.
export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date", withTimezone: true }),
  image: text("image"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "viewer"]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  // One workspace per account for the MVP, as defined in the build plan.
  ownerId: text("owner_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRole("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_members_user_idx").on(table.userId),
  ],
);

// A minimal chatbot table makes the first dashboard query tenant-scoped from
// day one. M1 will add sources, chunks, and embeddings.
export const chatbots = pgTable(
  "chatbots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    widgetConfig: jsonb("widget_config")
      .$type<{
        color: string;
        avatarUrl?: string;
        position: "left" | "right";
        welcomeMessage: string;
        starterQuestions: string[];
        allowedDomains: string[];
      }>()
      .notNull()
      .default({
        color: "#7065e8",
        position: "right",
        welcomeMessage: "Hi! How can I help you today?",
        starterQuestions: [],
        allowedDomains: [],
      }),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("chatbots_workspace_unique").on(table.workspaceId)],
);

export const sourceStatus = pgEnum("source_status", ["processing", "ready", "error"]);
export const messageRole = pgEnum("message_role", ["user", "assistant"]);
export const crawlJobStatus = pgEnum("crawl_job_status", [
  "discovered",
  "running",
  "complete",
  "partial",
  "failed",
]);

// Keep original text for re-indexing; website rows also retain their canonical
// URL and raw HTML hash so an unchanged page does not incur another embedding call.
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatbotId: uuid("chatbot_id")
      .notNull()
      .references(() => chatbots.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("text"),
    name: text("name").notNull(),
    url: text("url"),
    rawContentHash: text("raw_content_hash"),
    content: text("content").notNull(),
    status: sourceStatus("status").notNull().default("processing"),
    charCount: integer("char_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("sources_chatbot_idx").on(table.chatbotId),
    uniqueIndex("sources_chatbot_url_unique").on(table.chatbotId, table.url),
  ],
);

export const crawlJobs = pgTable(
  "crawl_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatbotId: uuid("chatbot_id")
      .notNull()
      .references(() => chatbots.id, { onDelete: "cascade" }),
    rootUrl: text("root_url").notNull(),
    status: crawlJobStatus("status").notNull().default("discovered"),
    discoveredPages: jsonb("discovered_pages")
      .$type<Array<{ url: string; title: string }>>()
      .notNull()
      .default([]),
    selectedUrls: jsonb("selected_urls").$type<string[]>().notNull().default([]),
    pageResults: jsonb("page_results")
      .$type<
        Array<{
          url: string;
          requestedUrl?: string;
          title?: string;
          status: string;
          message?: string;
        }>
      >()
      .notNull()
      .default([]),
    errorMessage: text("error_message"),
    totalPages: integer("total_pages").notNull().default(0),
    completedPages: integer("completed_pages").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("crawl_jobs_chatbot_created_idx").on(table.chatbotId, table.createdAt)],
);

// 1536 matches the default output size of text-embedding-3-small. The
// chatbot_id filter is part of every retrieval query for tenant isolation.
export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatbotId: uuid("chatbot_id")
      .notNull()
      .references(() => chatbots.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    tokenCount: integer("token_count").notNull(),
    contentHash: text("content_hash").notNull(),
    metadata: jsonb("metadata").$type<Record<string, string | number>>().notNull().default({}),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("chunks_chatbot_idx").on(table.chatbotId),
    index("chunks_source_order_idx").on(table.sourceId, table.chunkIndex),
    index("chunks_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

// M2 conversations are scoped through their chatbot. Every API lookup first
// proves that the chatbot belongs to the signed-in user's workspace.
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatbotId: uuid("chatbot_id")
      .notNull()
      .references(() => chatbots.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("conversations_chatbot_updated_idx").on(table.chatbotId, table.updatedAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sequence: serial("sequence").notNull().unique(),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    citedChunkIds: jsonb("cited_chunk_ids").$type<string[]>().notNull().default([]),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    isFallback: boolean("is_fallback").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("messages_conversation_sequence_idx").on(table.conversationId, table.sequence)],
);
