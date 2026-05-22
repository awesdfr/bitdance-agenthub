import { ChatPanel } from '@/components/chat-panel'
import { Sidebar } from '@/components/sidebar'

export default function Home() {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <ChatPanel />
    </div>
  )
}
