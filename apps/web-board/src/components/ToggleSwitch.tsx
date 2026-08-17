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
 * `describeOnDemand` keeps the description in the DOM but out of the layout,
 * revealed on hover or keyboard focus. It is for the places where the sentence
 * is worth having and not worth the two lines it costs every time the row is
 * drawn — a dense strip above a view, rather than a settings page where the
 * explanation *is* the content. Note what it does **not** do: the text is still
 * rendered and still referenced by `aria-describedby`, so a screen reader hears
 * it either way. Hiding a sentence from the people who can see the control is
 * one thing; hiding it from the people who cannot is another.
 */
import { t } from "../lib/i18n";

export function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  pending = false,
  describeOnDemand = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  pending?: boolean;
  /** Show the description only on hover or focus. See the note above. */
  describeOnDemand?: boolean;
}) {
  const slug = label.replace(/\W+/g, "-").toLowerCase();
  const labelId = `switch-label-${slug}`;
  const descriptionId = description ? `switch-desc-${slug}` : undefined;

  return (
    <div
      className={
        "board__switch-row" +
        (describeOnDemand ? " board__switch-row--ondemand" : "")
      }
    >
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
