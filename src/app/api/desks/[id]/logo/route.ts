import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  isPngSignature,
  readDeclaredSize,
  LOGO_MAX_BYTES,
  LOGO_MAX_PIXELS,
} from "@/lib/posters/logo";

/**
 * A setup's logo, stored so it survives the browser that uploaded it.
 *
 * Before this, logos lived in localStorage, so a poster rendered anywhere else
 * printed the name instead. The uploader saw their brand; the group saw text.
 *
 * The bucket is PRIVATE and the path is `<owner>/<desk>.png`, which is what
 * lets storage RLS enforce tenancy on the first path segment without a join.
 * The RLS-scoped client is used on purpose: storage policies then apply, so a
 * desk id belonging to someone else cannot be written to even if the check
 * below were ever wrong.
 */
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // RLS scopes this, so another owner's desk is absent rather than forbidden.
    const { data: desk } = await supabase
      .from("report_desks")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!desk) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was sent." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "That file is empty." }, { status: 400 });
    }
    if (file.size > LOGO_MAX_BYTES) {
      const mb = (LOGO_MAX_BYTES / 1024 / 1024).toFixed(0);
      return NextResponse.json(
        { error: `That file is over ${mb} MB. Export a smaller PNG.` },
        { status: 400 },
      );
    }

    // ONE read, then every check against the same bytes. Checking a slice and
    // re-reading the file would let the two disagree.
    const bytes = await file.arrayBuffer();

    // The content type is client-supplied and means nothing; the signature is
    // the actual test. A JPEG renamed .png would otherwise reach the renderer
    // and fail there, at 06:00, with nobody watching.
    if (!isPngSignature(new Uint8Array(bytes))) {
      return NextResponse.json(
        { error: "That is not a PNG. Export the logo as a PNG with no background." },
        { status: 400 },
      );
    }

    // Declared dimensions are read from the header BEFORE anything decodes the
    // image, so a small file claiming enormous dimensions is refused rather
    // than expanded in memory.
    const size = readDeclaredSize(bytes);
    if (!size || size.width === 0 || size.height === 0) {
      return NextResponse.json(
        { error: "That PNG's header could not be read." },
        { status: 400 },
      );
    }
    if (size.width * size.height > LOGO_MAX_PIXELS) {
      return NextResponse.json(
        { error: "That image is too large. Export it under 512px on the long edge." },
        { status: 400 },
      );
    }

    // The owner's id leads the path, which is exactly what the storage policy
    // checks. Fixed name per desk so a re-upload replaces rather than
    // accumulating orphans nobody will ever clean up.
    const path = `${user.id}/${id}.png`;

    const { error: uploadError } = await supabase.storage
      .from("desk-logos")
      .upload(path, bytes, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 502 });
    }

    const { error: saveError } = await supabase
      .from("report_desks")
      .update({ logo_path: path })
      .eq("id", id);

    if (saveError) {
      return NextResponse.json({ error: saveError.message }, { status: 500 });
    }

    return NextResponse.json({ data: { logo_path: path } });
  } catch (err: unknown) {
    console.error("[desks/logo] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Remove the logo, so the poster goes back to printing the name. */
export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: desk } = await supabase
      .from("report_desks")
      .select("id, logo_path")
      .eq("id", id)
      .maybeSingle();
    if (!desk) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // The row is cleared FIRST. If the storage delete fails afterwards the
    // poster is already correct and an orphaned file is harmless; the other
    // order would leave a row pointing at a file that no longer exists, and
    // every render would then try to sign a URL for nothing.
    const { error: clearError } = await supabase
      .from("report_desks")
      .update({ logo_path: null })
      .eq("id", id);
    if (clearError) {
      return NextResponse.json({ error: clearError.message }, { status: 500 });
    }

    if (desk.logo_path) {
      await supabase.storage.from("desk-logos").remove([desk.logo_path]);
    }

    return NextResponse.json({ data: { logo_path: null } });
  } catch (err: unknown) {
    console.error("[desks/logo] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
