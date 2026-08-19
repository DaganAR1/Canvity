import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Nav from "@/components/Nav";
import CanvasConnectForm from "@/components/CanvasConnectForm";
import CourseWeights from "@/components/CourseWeights";
import NotificationSettings from "@/components/NotificationSettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      digestEnabled: true,
      digestHour: true,
      canvasAccount: {
        select: {
          domain: true,
          lastSyncedAt: true,
          courses: {
            select: { id: true, name: true, courseCode: true, weight: true },
            orderBy: { name: "asc" },
          },
        },
      },
    },
  });

  if (!user) return null;

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-6 py-8">
        <h1 className="text-2xl font-bold">Settings</h1>

        <CanvasConnectForm
          connected={
            user.canvasAccount
              ? {
                  domain: user.canvasAccount.domain,
                  lastSyncedAt: user.canvasAccount.lastSyncedAt?.toISOString() ?? null,
                }
              : null
          }
        />

        <NotificationSettings
          digestEnabled={user.digestEnabled}
          digestHour={user.digestHour}
          email={user.email}
        />

        <CourseWeights courses={user.canvasAccount?.courses ?? []} />
      </main>
    </>
  );
}
