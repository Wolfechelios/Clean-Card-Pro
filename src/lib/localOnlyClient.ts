type Result<T = any> = Promise<{ data: T | null; error: any; count?: number | null }>;

const DB_NAME = "clean-card-pro-local";
const STORE = "tables";

function ok<T = any>(data: T | null = null, count: number | null = null): Result<T> {
  return Promise.resolve({ data, error: null, count });
}

function fail(error: any): Result<any> {
  return Promise.resolve({ data: null, error });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getTable(table: string): Promise<any[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(table);
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
    req.onerror = () => reject(req.error);
  });
}

async function setTable(table: string, rows: any[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(rows, table);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function matches(row: any, filters: any[]) {
  return filters.every((f) => {
    const value = row?.[f.col];
    if (f.op === "eq") return value === f.val;
    if (f.op === "neq") return value !== f.val;
    if (f.op === "gt") return value > f.val;
    if (f.op === "gte") return value >= f.val;
    if (f.op === "lt") return value < f.val;
    if (f.op === "lte") return value <= f.val;
    if (f.op === "in") return Array.isArray(f.val) && f.val.includes(value);
    if (f.op === "like" || f.op === "ilike") {
      const needle = String(f.val).split("%").join("").toLowerCase();
      return String(value ?? "").toLowerCase().includes(needle);
    }
    return true;
  });
}

function chain(table: string): any {
  const state: any = {
    table,
    action: "select",
    payload: null,
    filters: [],
    limitValue: null,
    orderCol: null,
    ascending: true,
    countMode: false,
    headOnly: false,
  };

  const execute = async () => {
    try {
      let rows = await getTable(table);

      if (state.action === "insert") {
        const input = Array.isArray(state.payload) ? state.payload : [state.payload];
        const inserted = input.map((r) => ({ id: r?.id ?? makeId(), created_at: r?.created_at ?? new Date().toISOString(), ...r }));
        rows = [...rows, ...inserted];
        await setTable(table, rows);
        return { data: inserted, error: null, count: inserted.length };
      }

      if (state.action === "upsert") {
        const input = Array.isArray(state.payload) ? state.payload : [state.payload];
        const upserted = input.map((r) => ({ id: r?.id ?? makeId(), updated_at: new Date().toISOString(), ...r }));
        for (const item of upserted) {
          const idx = rows.findIndex((r) => r.id === item.id);
          if (idx >= 0) rows[idx] = { ...rows[idx], ...item };
          else rows.push(item);
        }
        await setTable(table, rows);
        return { data: upserted, error: null, count: upserted.length };
      }

      if (state.action === "update") {
        const updated: any[] = [];
        rows = rows.map((row) => {
          if (!matches(row, state.filters)) return row;
          const next = { ...row, ...state.payload, updated_at: new Date().toISOString() };
          updated.push(next);
          return next;
        });
        await setTable(table, rows);
        return { data: updated, error: null, count: updated.length };
      }

      if (state.action === "delete") {
        const deleted = rows.filter((row) => matches(row, state.filters));
        rows = rows.filter((row) => !matches(row, state.filters));
        await setTable(table, rows);
        return { data: deleted, error: null, count: deleted.length };
      }

      let result = rows.filter((row) => matches(row, state.filters));

      if (state.orderCol) {
        result = result.sort((a, b) => {
          const av = a?.[state.orderCol];
          const bv = b?.[state.orderCol];
          if (av === bv) return 0;
          return state.ascending ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
        });
      }

      if (typeof state.limitValue === "number") result = result.slice(0, state.limitValue);

      if (state.headOnly) return { data: null, error: null, count: result.length };
      return { data: result, error: null, count: result.length };
    } catch (err) {
      return { data: null, error: err, count: 0 };
    }
  };

  const api: any = {
    select: (_cols?: any, opts?: any) => {
      state.action = "select";
      state.countMode = Boolean(opts?.count);
      state.headOnly = Boolean(opts?.head);
      return api;
    },
    insert: (payload: any) => {
      state.action = "insert";
      state.payload = payload;
      return api;
    },
    update: (payload: any) => {
      state.action = "update";
      state.payload = payload;
      return api;
    },
    upsert: (payload: any) => {
      state.action = "upsert";
      state.payload = payload;
      return api;
    },
    delete: () => {
      state.action = "delete";
      return api;
    },
    eq: (col: string, val: any) => {
      state.filters.push({ op: "eq", col, val });
      return api;
    },
    neq: (col: string, val: any) => {
      state.filters.push({ op: "neq", col, val });
      return api;
    },
    gt: (col: string, val: any) => {
      state.filters.push({ op: "gt", col, val });
      return api;
    },
    gte: (col: string, val: any) => {
      state.filters.push({ op: "gte", col, val });
      return api;
    },
    lt: (col: string, val: any) => {
      state.filters.push({ op: "lt", col, val });
      return api;
    },
    lte: (col: string, val: any) => {
      state.filters.push({ op: "lte", col, val });
      return api;
    },
    in: (col: string, val: any[]) => {
      state.filters.push({ op: "in", col, val });
      return api;
    },
    like: (col: string, val: any) => {
      state.filters.push({ op: "like", col, val });
      return api;
    },
    ilike: (col: string, val: any) => {
      state.filters.push({ op: "ilike", col, val });
      return api;
    },
    or: () => api,
    range: (_from: number, to: number) => {
      state.limitValue = to + 1;
      return api;
    },
    order: (col: string, opts?: any) => {
      state.orderCol = col;
      state.ascending = opts?.ascending !== false;
      return api;
    },
    limit: (n: number) => {
      state.limitValue = n;
      return api;
    },
    single: async () => {
      const res = await execute();
      return { ...res, data: Array.isArray(res.data) ? res.data[0] ?? null : res.data };
    },
    maybeSingle: async () => {
      const res = await execute();
      return { ...res, data: Array.isArray(res.data) ? res.data[0] ?? null : res.data };
    },
    then: (resolve: any, reject: any) => execute().then(resolve, reject),
  };

  return api;
}

const LOCAL_USER = {
  id: "local-user",
  aud: "authenticated",
  role: "authenticated",
  email: "local@device",
  app_metadata: {},
  user_metadata: {},
  created_at: new Date(0).toISOString(),
};

const LOCAL_SESSION = {
  access_token: "local-only",
  refresh_token: "local-only",
  token_type: "bearer",
  expires_in: 31536000,
  expires_at: Math.floor(Date.now() / 1000) + 31536000,
  user: LOCAL_USER,
};

export const localOnlyClient: any = {
  from: (table: string) => chain(table),

  auth: {
    getSession: () => ok({ session: LOCAL_SESSION }),
    getUser: () => ok({ user: LOCAL_USER }),
    signOut: () => ok(null),
    signInWithPassword: () => fail({ message: "Cloud auth disabled. Local-only mode is active." }),
    signUp: () => fail({ message: "Cloud auth disabled. Local-only mode is active." }),
    updateUser: () => ok(null),
    onAuthStateChange: (callback?: (event: string, session: any) => void) => {
      if (typeof callback === "function") {
        setTimeout(() => callback("SIGNED_IN", LOCAL_SESSION), 0);
      }
      return {
        data: {
          subscription: {
            unsubscribe: () => {},
          },
        },
      };
    },
  },

  storage: {
    from: () => ({
      upload: async (path: string, file: Blob) => {
        try {
          const key = `local-file:${path}`;
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          localStorage.setItem(key, dataUrl);
          return { data: { path }, error: null };
        } catch (err) {
          return { data: null, error: err };
        }
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: localStorage.getItem(`local-file:${path}`) ?? path },
      }),
      remove: (paths: string[]) => {
        for (const path of paths ?? []) localStorage.removeItem(`local-file:${path}`);
        return ok(null);
      },
    }),
  },

  functions: {
    invoke: () => fail({ message: "Cloud functions disabled. Local-only mode is active." }),
  },

  channel: () => ({
    on: function () {
      return this;
    },
    subscribe: function () {
      return this;
    },
  }),

  removeChannel: () => ok(null),
};
