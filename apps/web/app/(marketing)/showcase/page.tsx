import Link from 'next/link';
import { ArrowLeft, Check, X, AlertCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function ShowcasePage() {
  return (
    <main className="mx-auto max-w-7xl p-6 md:p-10">
      {/* Header */}
      <div className="mb-8">
        <Button variant="ghost" asChild className="mb-4">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>
        </Button>
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Component Showcase</h1>
        <p className="mt-2 text-muted-foreground">
          All shadcn/ui components available in this project
        </p>
      </div>

      <div className="space-y-8">
        {/* Buttons */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Buttons</h2>
          <Card>
            <CardHeader>
              <CardTitle>Button Variants</CardTitle>
              <CardDescription>Different styles and sizes for various use cases</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Button>Default</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button disabled>Disabled</Button>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button size="sm">Small</Button>
                <Button size="default">Default</Button>
                <Button size="lg">Large</Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Badges */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Badges</h2>
          <Card>
            <CardHeader>
              <CardTitle>Status Indicators</CardTitle>
              <CardDescription>
                Use badges to highlight status, labels, or categories
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <Badge>Default</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="destructive">Destructive</Badge>
                <Badge className="bg-green-500">Success</Badge>
                <Badge className="bg-yellow-500">Warning</Badge>
                <Badge className="bg-blue-500">Info</Badge>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Forms */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Form Elements</h2>
          <Card>
            <CardHeader>
              <CardTitle>Input Components</CardTitle>
              <CardDescription>Text inputs, textareas, and form controls</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" placeholder="Enter your name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="name@example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">Message</Label>
                <Textarea id="message" placeholder="Type your message here" rows={4} />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Tabs */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Tabs</h2>
          <Card>
            <CardHeader>
              <CardTitle>Tabbed Content</CardTitle>
              <CardDescription>Organize content into switchable views</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="analytics">Analytics</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="space-y-4">
                  <div className="rounded-lg border p-4">
                    <h3 className="font-semibold mb-2">Overview Content</h3>
                    <p className="text-sm text-muted-foreground">
                      This is the overview tab. You can display summary information here.
                    </p>
                  </div>
                </TabsContent>
                <TabsContent value="analytics" className="space-y-4">
                  <div className="rounded-lg border p-4">
                    <h3 className="font-semibold mb-2">Analytics Content</h3>
                    <p className="text-sm text-muted-foreground">
                      Charts, metrics, and data visualizations go here.
                    </p>
                  </div>
                </TabsContent>
                <TabsContent value="settings" className="space-y-4">
                  <div className="rounded-lg border p-4">
                    <h3 className="font-semibold mb-2">Settings Content</h3>
                    <p className="text-sm text-muted-foreground">
                      Configuration options and preferences.
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </section>

        {/* Avatars */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Avatars</h2>
          <Card>
            <CardHeader>
              <CardTitle>User Avatars</CardTitle>
              <CardDescription>
                Display user profile pictures with fallback initials
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Avatar>
                  <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
                  <AvatarFallback>CN</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>AB</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>CD</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback className="bg-primary text-primary-foreground">EF</AvatarFallback>
                </Avatar>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Tables */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Tables</h2>
          <Card>
            <CardHeader>
              <CardTitle>Data Tables</CardTitle>
              <CardDescription>Display structured data in rows and columns</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Alice Johnson</TableCell>
                    <TableCell>
                      <Badge className="bg-green-500">Active</Badge>
                    </TableCell>
                    <TableCell>Admin</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost">
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Bob Smith</TableCell>
                    <TableCell>
                      <Badge className="bg-green-500">Active</Badge>
                    </TableCell>
                    <TableCell>Developer</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost">
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Carol White</TableCell>
                    <TableCell>
                      <Badge variant="outline">Inactive</Badge>
                    </TableCell>
                    <TableCell>Designer</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost">
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        {/* Alert-style Cards */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Status Cards</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-green-500/50 bg-green-500/5">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Check className="h-5 w-5 text-green-500" />
                  <CardTitle className="text-green-500">Success</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm">Your changes have been saved successfully.</p>
              </CardContent>
            </Card>

            <Card className="border-red-500/50 bg-red-500/5">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <X className="h-5 w-5 text-red-500" />
                  <CardTitle className="text-red-500">Error</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm">Something went wrong. Please try again.</p>
              </CardContent>
            </Card>

            <Card className="border-yellow-500/50 bg-yellow-500/5">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-yellow-500" />
                  <CardTitle className="text-yellow-500">Warning</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm">This action cannot be undone. Proceed with caution.</p>
              </CardContent>
            </Card>

            <Card className="border-blue-500/50 bg-blue-500/5">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Info className="h-5 w-5 text-blue-500" />
                  <CardTitle className="text-blue-500">Info</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm">New features are available. Check the changelog.</p>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
