import { neon } from '@neondatabase/serverless';

export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  return neon(url);
}

export function serverUrl() {
  const value = process.env.MCP_SERVER_URL;
  if (!value) throw new Error('MCP_SERVER_URL is not configured');
  return value;
}
