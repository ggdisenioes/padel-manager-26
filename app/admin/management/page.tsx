import { redirect } from "next/navigation";

export default function AdminManagementRedirectPage() {
  redirect("/admin/users");
}
