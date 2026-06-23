import { NextResponse } from 'next/server'

import {
  getSkillsMarketplaceUrl,
  listSkillInstallFlows,
  listSkills,
} from '@/server/skills-service'

export async function GET() {
  return NextResponse.json({
    skills: await listSkills(),
    installFlows: await listSkillInstallFlows(),
    marketplaceUrl: getSkillsMarketplaceUrl(),
  })
}
