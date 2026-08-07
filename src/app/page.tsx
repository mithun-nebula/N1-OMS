import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";

export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? "/today" : "/login");
}
