import React from "react";
import type { ItemRenderer } from "../registry.js";
import type {
  SettingsBrowserItem,
  SettingsCategoryItem,
  SettingsSettingItem,
} from "../adapters/settingsAdapter.js";
import {
  CATEGORY_LABELS,
  CATEGORY_BG,
  CATEGORY_COLOR,
  CATEGORY_DESCRIPTIONS,
  formatValue,
} from "../adapters/settingsAdapter.js";
import { SelectableRow, MetaText } from "../components/primitives/index.js";
import { theme } from "../theme.js";

// ─── Category renderer ─────────────────────────────────────────────────────────

const categoryRenderer: ItemRenderer<SettingsCategoryItem> = {
  renderRow: ({ item, isSelected }) => {
    const star = item.category === "recommended" ? "★ " : "";
    const label = `${star}${CATEGORY_LABELS[item.category]}`;
    const bg = isSelected ? theme.selection.bg : CATEGORY_BG[item.category];

    return (
      <box width="100%">
        <text bg={bg} fg="white">
          <strong> {label} </strong>
        </text>
      </box>
    );
  },

  renderDetail: ({ item }) => {
    const cat = item.category;
    return (
      <box flexDirection="column">
        <text fg={CATEGORY_COLOR[cat]}>
          <strong>{CATEGORY_LABELS[cat]}</strong>
        </text>
        <box marginTop={1}>
          <text fg={theme.colors.muted}>{CATEGORY_DESCRIPTIONS[cat]}</text>
        </box>
      </box>
    );
  },
};

// ─── Setting renderer ──────────────────────────────────────────────────────────

const settingRenderer: ItemRenderer<SettingsSettingItem> = {
  renderRow: ({ item, isSelected }) => {
    const { setting } = item;
    const indicator = item.isDefault ? "○" : "●";
    const displayValue = formatValue(setting, item.effectiveValue);

    if (isSelected) {
      return (
        <text bg={theme.selection.bg} fg={theme.selection.fg}>
          {" "}
          {indicator} {setting.name.padEnd(28)}
          {displayValue}{" "}
        </text>
      );
    }

    const indicatorColor = item.isDefault ? theme.colors.muted : theme.colors.info;
    const valueColor = item.isDefault ? theme.colors.muted : theme.colors.success;

    return (
      <text>
        <span fg={indicatorColor}> {indicator} </span>
        <span>{setting.name.padEnd(28)}</span>
        <span fg={valueColor}>{displayValue}</span>
      </text>
    );
  },

  renderDetail: ({ item }) => {
    const { setting } = item;
    const scoped = item.scopedValues;
    const storageDesc =
      setting.storage.type === "attribution"
        ? "settings.json: attribution"
        : setting.storage.type === "attribution-text"
          ? "settings.json: attribution"
          : setting.storage.type === "env"
            ? `env: ${setting.storage.key}`
            : `settings.json: ${setting.storage.key}`;

    const userValue = formatValue(setting, scoped.user);
    const projectValue = formatValue(setting, scoped.project);
    const userIsSet = scoped.user !== undefined && scoped.user !== "";
    const projectIsSet = scoped.project !== undefined && scoped.project !== "";

    const actionLabel =
      setting.type === "boolean"
        ? "toggle"
        : setting.type === "select"
          ? "choose"
          : "edit";

    return (
      <box flexDirection="column">
        <text fg={theme.colors.info}>
          <strong>{setting.name}</strong>
        </text>
        <box marginTop={1}>
          <text fg={theme.colors.text}>{setting.description}</text>
        </box>

        <box marginTop={1}>
          <text>
            <span fg={theme.colors.muted}>Stored </span>
            <span fg={theme.colors.link}>{storageDesc}</span>
          </text>
        </box>
        {setting.defaultValue !== undefined && (
          <box>
            <text>
              <span fg={theme.colors.muted}>Default </span>
              <span>{setting.defaultValue}</span>
            </text>
          </box>
        )}

        <box flexDirection="column" marginTop={1}>
          <text>{"────────────────────────"}</text>
          <text>
            <strong>Scopes:</strong>
          </text>
          <box marginTop={1} flexDirection="column">
            <text>
              <span bg={theme.scopes.user} fg="black">
                {" "}
                u{" "}
              </span>
              <span fg={userIsSet ? theme.scopes.user : theme.colors.muted}>
                {userIsSet ? " ● " : " ○ "}
              </span>
              <span fg={theme.scopes.user}>User</span>
              <span> global</span>
              <span fg={userIsSet ? theme.scopes.user : theme.colors.muted}>
                {" "}
                {userValue}
              </span>
            </text>
            <text>
              <span bg={theme.scopes.project} fg="black">
                {" "}
                p{" "}
              </span>
              <span
                fg={projectIsSet ? theme.scopes.project : theme.colors.muted}
              >
                {projectIsSet ? " ● " : " ○ "}
              </span>
              <span fg={theme.scopes.project}>Project</span>
              <span> team</span>
              <span
                fg={projectIsSet ? theme.scopes.project : theme.colors.muted}
              >
                {" "}
                {projectValue}
              </span>
            </text>
          </box>
        </box>

        <box marginTop={1}>
          <text fg={theme.colors.muted}>Press u/p to {actionLabel} in scope</text>
        </box>
      </box>
    );
  },
};

// ─── Dispatch helpers ──────────────────────────────────────────────────────────

export const settingsRenderers: {
  category: ItemRenderer<SettingsCategoryItem>;
  setting: ItemRenderer<SettingsSettingItem>;
} = {
  category: categoryRenderer,
  setting: settingRenderer,
};

export function renderSettingRow(
  item: SettingsBrowserItem,
  _index: number,
  isSelected: boolean,
): React.ReactNode {
  if (item.kind === "category") {
    return settingsRenderers.category.renderRow({ item, isSelected });
  }
  return settingsRenderers.setting.renderRow({ item, isSelected });
}

export function renderSettingDetail(
  item: SettingsBrowserItem | undefined,
): React.ReactNode {
  if (!item) return <text fg={theme.colors.muted}>Select a setting to see details</text>;
  if (item.kind === "category") {
    return settingsRenderers.category.renderDetail({ item });
  }
  return settingsRenderers.setting.renderDetail({ item });
}

// Suppress unused import warning — MetaText may be used in future extensions
void (MetaText as unknown);
