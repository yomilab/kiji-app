export interface Tag {
  name: string; // Unique tag identifier
  feedIds: string[]; // Feeds with this tag
  color?: string; // Optional color for UI
  createdAt: string; // ISO timestamp
  emoji?: string; // Unicode emoji character for custom icon
  sortOrder?: number;
}
