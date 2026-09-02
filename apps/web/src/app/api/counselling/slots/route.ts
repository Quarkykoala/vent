import { NextResponse } from 'next/server';

export async function GET() {
  const mockSlots = [
    {
      slotId: 'slot-101',
      counsellorId: 'counsellor-dr-sharma',
      counsellorName: 'Dr. Sharma (Verified Clinical Psychologist)',
      startTimeIso: new Date(Date.now() + 86400000).toISOString(),
      endTimeIso: new Date(Date.now() + 86400000 + 2700000).toISOString(), // +45 mins
      isBooked: false,
      pricePaise: 99900,
    },
    {
      slotId: 'slot-102',
      counsellorId: 'counsellor-dr-menon',
      counsellorName: 'Dr. Menon (Licensed Counsellor)',
      startTimeIso: new Date(Date.now() + 172800000).toISOString(),
      endTimeIso: new Date(Date.now() + 172800000 + 2700000).toISOString(),
      isBooked: false,
      pricePaise: 99900,
    },
  ];

  return NextResponse.json({ slots: mockSlots });
}
