/** Optional zero-based pagination parameters accepted by list endpoints. */
export interface PageQuery {
  page?: number;
  size?: number;
  sort?: string;
}
