import { PageHero } from "@/components/work/PageHero";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <PageHero eyebrow="404 · Lost in the hills" title="Nothing grows here." blurb="That page wandered off. Head back to the valley and pick a door.">
      <Button href="/">Take me home</Button>
    </PageHero>
  );
}
