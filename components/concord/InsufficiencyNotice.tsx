"use client";

/**
 * Insufficiency is a first-class UI state (spec §11). Styled as information,
 * not error: Concord names the gap and offers to widen the query. Admitting
 * gaps is the strongest signal the citations are real.
 */

export function InsufficiencyNotice({
  traditions,
  reason,
  onWiden,
}: {
  traditions: string[];
  reason?: string;
  onWiden?: () => void;
}) {
  return (
    <div className="insufficiency" role="status">
      {traditions.length > 0 ? (
        <p style={{ margin: 0 }}>
          <strong>Insufficient primary sources:</strong> {traditions.join(", ")}. Concord
          reports a tradition&apos;s teaching only from its own primary literature, and it
          does not have enough of it for this question yet.
        </p>
      ) : (
        <p style={{ margin: 0 }}>
          <strong>No sourced material.</strong>{" "}
          {reason ?? "Concord has no sources above threshold for this question, and it does not answer from memory."}
        </p>
      )}
      {onWiden ? (
        <p style={{ margin: "0.5rem 0 0" }}>
          <button className="chip" onClick={onWiden}>
            Widen the question
          </button>
        </p>
      ) : null}
    </div>
  );
}
