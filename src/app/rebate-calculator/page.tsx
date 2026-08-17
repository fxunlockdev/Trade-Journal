import type { Metadata } from "next";
import { RebateCalculator } from "./RebateCalculator";

export const metadata: Metadata = {
  title: "Rebate Calculator · FXU",
  description:
    "Estimate what your monthly trading volume could be worth as an FXU introducing broker. Free to use.",
};

export default function RebateCalculatorPage() {
  return <RebateCalculator />;
}
