import type { Metadata } from "next";
import { Education } from "./Education";

export const metadata: Metadata = {
  title: "Live Education · FXU",
  description:
    "Live, practical trading education for FXU partner communities — patterns, risk, psychology and review. No signal hype.",
};

export default function EducationPage() {
  return <Education />;
}
