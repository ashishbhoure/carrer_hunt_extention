import { useNavigate } from "react-router-dom";
import { Banner, Button, EmptyState, PageHeader, SkeletonRows, useToast } from "../../ui/kit";
import { useLive } from "../../ui/hooks";
import { profileRepo } from "../../storage/db";
import { ProfileEditor } from "../components/ProfileEditor";

export function ProfilePage() {
  const { data, loading } = useLive(() => profileRepo.get(), []);
  const toast = useToast();
  const nav = useNavigate();
  if (loading) return <SkeletonRows />;
  if (!data) return <><PageHeader title="Master profile" /><EmptyState title="No profile yet" body="Upload a resume and we'll build a profile for you to verify." action={<Button variant="primary" onClick={() => nav("/resumes")}>Upload resume</Button>} /></>;
  return (
    <div>
      <PageHeader title="Master profile" subtitle="The verified source of truth for scoring, tailoring and autofill. Separate from any one resume file." />
      <div className="mb-5"><Banner tone="info">Skill levels you set here are used exactly as written. CareerPilot and AI suggestions can never raise a level without you.</Banner></div>
      <ProfileEditor profile={data} onSave={async (p) => { await profileRepo.put(p); toast.push({ tone: "good", text: "Profile saved." }); }} />
    </div>
  );
}
