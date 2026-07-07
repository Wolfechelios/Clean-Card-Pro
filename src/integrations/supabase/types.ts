export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = any;

export type Tables<T extends string> = any;
export type TablesInsert<T extends string> = any;
export type TablesUpdate<T extends string> = any;
