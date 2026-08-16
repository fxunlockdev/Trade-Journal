import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PRODUCT_COPY, type LockedProductKey } from "@/lib/copy/products";

/**
 * Shown when a signed-in user opens a product their tier does not include.
 *
 * Deliberately not a 404 or an error: the CRM is something they could
 * legitimately be granted, so the screen explains what it is and how access
 * works instead of looking broken (F29).
 */

// Personalized surface — never cached or statically rendered.
export const dynamic = "force-dynamic";

function isLockedProductKey(
  value: string | undefined,
): value is LockedProductKey {
  return value === "crm" || value === "admin";
}

export default async function LockedPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { product } = await searchParams;
  const copy = isLockedProductKey(product)
    ? PRODUCT_COPY[product]
    : PRODUCT_COPY.default;

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div
            className="bg-muted mb-3 flex size-11 items-center justify-center rounded-full"
            aria-hidden="true"
          >
            <Lock className="size-5" />
          </div>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">{copy.howToGetAccess}</p>
          <div className="flex gap-2">
            <Link href="/dashboard" className={buttonVariants()}>
              Back to Trade Journal
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
