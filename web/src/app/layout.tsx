import type { Metadata } from "next";
import { Noto_Serif_Thai } from "next/font/google";
import "./globals.css";

const notoSerifThai = Noto_Serif_Thai({
  variable: "--font-noto-serif-thai",
  subsets: ["thai", "latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "โรงเตี๊ยมมังกรทอง — ระบบจองโต๊ะออนไลน์",
  description:
    "ระบบจองโต๊ะออนไลน์ของโรงเตี๊ยมมังกรทอง ร้านอาหารจีนสไตล์ย้อนยุค เลือกวัน เวลา และจำนวนที่นั่งได้ในไม่กี่ขั้นตอน",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${notoSerifThai.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex flex-col bg-cloud-pattern text-ink">
        {children}
      </body>
    </html>
  );
}
