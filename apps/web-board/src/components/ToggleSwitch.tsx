/**
 * An accessible on/off switch (Phase 5.3).
 *
 * A real `role="switch"` button with `aria-checked` rather than a styled
 * checkbox: screen readers announce it as "on"/"off" and it is operable from the
 * keyboard for free. The visual knob is `aria-hidden` — the state lives in the
 * ARIA attribute, not in the pixels.
 *
 * `pending` disables the control while a write is in flight so a double-click
 * cannot queue two opposite updates and land on the wrong one.
 *
 * It had a `describeOnDemand` mode that kept the description in the DOM and out
 * of the layout, for the one dense strip that wanted a switch without the two
 * lines under it. That strip now carries a pressed chip instead — a switch
 * earns its knob, its caption and its label as one row among many settings,
 * which is what this is used for and all it is used for. The mode went with its
 * only caller rather than waiting in the file for a second one.
 */
import { t } from "../lib/i18n";

export function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  pending = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  pending?: boolean;
}) {
  const slug = label.replace(/\W+/g, "-").toLowerCase();
  const labelId = `switch-label-${slug}`;
  const descriptionId = description ? `switch-desc-${slug}` : undefined;

  return (
    <div className="board__switch-row">
      <span className="board__switch-text">
        <span className="board__switch-label" id={labelId}>
          {label}
        </span>
        {description ? (
          <span className="board__switch-desc" id={descriptionId}>
            {description}
          </span>
        ) : null}
      </span>
      {/* The button's own content is just the knob and an On/Off caption, so
          name it from the visible label and let aria-checked carry the state —
          otherwise a screen reader announces the switch as "On, switch, on". */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        className="board__switch"
        disabled={pending}
        onClick={() => onChange(!checked)}
      >
        <span className="board__switch-knob" aria-hidden="true" />
        <span className="board__switch-state">
          {checked ? t("On") : t("Off")}
        </span>
      </button>
    </div>
  );
}
