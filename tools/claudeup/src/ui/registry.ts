import type React from "react";

export interface RowRenderProps<T> {
  item: T;
  isSelected: boolean;
  width?: number;
}

export interface DetailRenderProps<T> {
  item: T;
}

export interface Hint {
  key: string;
  label: string;
  tone?: "default" | "primary" | "danger";
}

export interface ItemRenderer<T> {
  renderRow: (props: RowRenderProps<T>) => React.ReactNode;
  renderDetail: (props: DetailRenderProps<T>) => React.ReactNode;
  getActionHints?: (item: T) => Hint[];
}

export type RendererRegistry<TItem extends { kind: string }> = {
  [K in TItem["kind"]]: ItemRenderer<Extract<TItem, { kind: K }>>;
};
