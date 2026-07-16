export interface BracketEntity {
  id: number;
  user: string;
  title: string;
  subtitle: string;
  slug: string;
  picture: string;
  items: number;
}

export interface BracketItemEntity {
  id: number;
  title: string;
  subtitle: string;
  slug: string;
  file_url: string;
  media_type: string;
  bracket_id: string;
}
