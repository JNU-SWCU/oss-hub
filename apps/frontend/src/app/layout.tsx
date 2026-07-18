import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "OSS Hub",
  description: "오픈소스 허브",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
