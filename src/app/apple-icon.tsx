import { ImageResponse } from "next/og";

/**
 * The iOS home-screen icon.
 *
 * Rendered rather than committed as a binary so it can never drift from
 * icon.svg and the sidebar mark. Deliberately full-bleed with no rounded
 * corners of its own: iOS applies its own mask, and baking a radius in leaves
 * pale slivers outside it.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const bar = { width: 25, borderRadius: 13, background: "#0b1a12" };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          paddingBottom: 34,
          background: "linear-gradient(135deg, #c3f35c 0%, #6c9e75 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: 13 }}>
          <div style={{ ...bar, height: 39 }} />
          <div style={{ ...bar, height: 68 }} />
          <div style={{ ...bar, height: 96 }} />
        </div>
      </div>
    ),
    size,
  );
}
