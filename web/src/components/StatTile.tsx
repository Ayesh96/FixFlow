import { Card, CardContent } from '@/components/ui/card';

interface Props {
  label: string;
  value: string;
  sub?: string;
}

/** label → value → what it counts. Headline numbers are figures, not charts. */
export function StatTile({ label, value, sub }: Props) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex h-full flex-col gap-1 p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
