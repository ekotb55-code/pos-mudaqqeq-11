import React from 'react';
import {
  SETTINGS_GROUPS,
  SettingsSectionId,
  SettingsSectionMeta
} from './settingsSections';
import { getHrefForTarget, isPlainLeftClick } from '../../config/navigation';

interface SettingsSectionNavProps {
  visibleSections: SettingsSectionMeta[];
  activeSection: SettingsSectionId;
  onSelectSection: (id: SettingsSectionId) => void;
  sectionDirtyMap: Partial<Record<SettingsSectionId, boolean>>;
  usersCount?: number;
}

export const SettingsSectionNav: React.FC<SettingsSectionNavProps> = ({
  visibleSections,
  activeSection,
  onSelectSection,
  sectionDirtyMap,
  usersCount
}) => {
  const getSectionDisplayLabel = (sec: SettingsSectionMeta) => {
    if (sec.id === 'users' && typeof usersCount === 'number') {
      return `المستخدمون (${usersCount})`;
    }
    return sec.label;
  };

  return (
    <>
      {/* Mobile / Tablet Selector (< lg): Dropdown with optgroups for zero horizontal overflow */}
      <div className="lg:hidden space-y-1.5 pb-4 border-b border-[var(--border-subtle)]">
        <label
          htmlFor="settings-mobile-section-select"
          className="block text-[11px] font-bold text-[var(--text-secondary)]"
        >
          قسم الإعدادات
        </label>
        <select
          id="settings-mobile-section-select"
          aria-label="اختيار قسم الإعدادات"
          data-testid="settings-mobile-section-select"
          value={activeSection}
          onChange={(e) => onSelectSection(e.target.value as SettingsSectionId)}
          className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--surface)] text-xs font-bold text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] cursor-pointer"
        >
          {SETTINGS_GROUPS.map((group) => {
            const groupSections = visibleSections.filter((s) => s.groupId === group.id);
            if (groupSections.length === 0) return null;
            return (
              <optgroup key={group.id} label={group.label}>
                {groupSections.map((sec) => {
                  const isDirty = Boolean(sectionDirtyMap[sec.id]);
                  return (
                    <option key={sec.id} value={sec.id}>
                      {getSectionDisplayLabel(sec)}
                      {isDirty ? ' • (غير محفوظ)' : ''}
                    </option>
                  );
                })}
              </optgroup>
            );
          })}
        </select>
      </div>

      {/* Desktop Internal Sections Menu (lg+): Calm grouped vertical list on RTL start */}
      <aside className="hidden lg:block sticky top-4 self-start">
        <nav
          aria-label="أقسام إعدادات البرنامج"
          data-testid="settings-sections-nav"
          className="space-y-4 pb-2 border-l border-[var(--border-subtle)] pl-4"
        >
          {SETTINGS_GROUPS.map((group, groupIdx) => {
            const groupSections = visibleSections.filter((s) => s.groupId === group.id);
            if (groupSections.length === 0) return null;
            return (
              <div
                key={group.id}
                className={groupIdx > 0 ? 'pt-3 border-t border-[var(--border-subtle)] space-y-1' : 'space-y-1'}
              >
                <div className="px-2.5 pb-1 text-[11px] font-bold text-[var(--text-secondary)]">
                  {group.label}
                </div>
                <ul className="space-y-0.5">
                  {groupSections.map((sec) => {
                    const Icon = sec.icon;
                    const isActive = activeSection === sec.id;
                    const isDirty = Boolean(sectionDirtyMap[sec.id]);
                    return (
                      <li key={sec.id}>
                        <a
                          href={getHrefForTarget('settings', sec.id)}
                          onClick={(e) => {
                            if (!isPlainLeftClick(e)) return;
                            e.preventDefault();
                            onSelectSection(sec.id);
                          }}
                          aria-current={isActive ? 'page' : undefined}
                          data-testid={`settings-nav-${sec.id}`}
                          className={`w-full min-h-[40px] px-2.5 py-2 rounded-lg text-right flex items-center justify-between gap-2 text-xs transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] no-underline ${
                            isActive
                              ? 'bg-[var(--surface-subtle)] border border-[var(--border-color)] text-[var(--primary-on-white,var(--primary))] font-bold'
                              : 'border border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]/60 font-medium'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <Icon
                              className={`w-4 h-4 shrink-0 ${
                                isActive
                                  ? 'text-[var(--primary-on-white,var(--primary))]'
                                  : 'text-[var(--text-secondary)]'
                              }`}
                            />
                            <span className="truncate">{getSectionDisplayLabel(sec)}</span>
                          </span>
                          {isDirty && (
                            <span
                              title="يوجد تغييرات غير محفوظة في هذا القسم"
                              aria-label="تغييرات غير محفوظة"
                              className="w-2 h-2 rounded-full bg-amber-500 shrink-0"
                            />
                          )}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
};

interface SettingsSectionHeaderProps {
  section: SettingsSectionMeta;
  titleOverride?: string;
}

export const SettingsSectionHeader: React.FC<SettingsSectionHeaderProps> = ({
  section,
  titleOverride
}) => {
  const Icon = section.icon;
  return (
    <div className="flex items-start gap-3 pb-4 border-b border-[var(--border-subtle)]">
      <div className="w-9 h-9 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-[var(--primary-on-white,var(--primary))]" />
      </div>
      <div className="min-w-0">
        <h2 className="text-base font-bold text-[var(--text-primary)] leading-snug">
          {titleOverride || section.title}
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
          {section.subtitle}
        </p>
      </div>
    </div>
  );
};
