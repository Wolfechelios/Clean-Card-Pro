import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, Tag, Award, Globe, ExternalLink } from "lucide-react";
import { VisionLabel, VisionLogo, WebEntity } from "@/lib/analyzeCardFull";
import { Button } from "@/components/ui/button";

interface CardVisionInsightsProps {
  labels: VisionLabel[];
  logos: VisionLogo[];
  webDetection: {
    entities: WebEntity[];
    similar_images: string[];
    matching_images: string[];
  };
}

export default function CardVisionInsights({ labels, logos, webDetection }: CardVisionInsightsProps) {
  // Categorize labels
  const sportLabels = labels.filter(l => 
    ['football', 'basketball', 'baseball', 'soccer', 'hockey', 'sports'].some(s => 
      l.description.toLowerCase().includes(s)
    )
  );

  const gameLabels = labels.filter(l => 
    ['pokemon', 'magic', 'yugioh', 'card game', 'trading card'].some(s => 
      l.description.toLowerCase().includes(s)
    )
  );

  const conditionLabels = labels.filter(l => 
    ['vintage', 'collectible', 'rare', 'mint', 'pristine', 'glossy'].some(s => 
      l.description.toLowerCase().includes(s)
    )
  );

  const otherLabels = labels.filter(l => 
    !sportLabels.includes(l) && !gameLabels.includes(l) && !conditionLabels.includes(l)
  );

  const getConfidenceColor = (score: number) => {
    if (score > 0.9) return "default";
    if (score > 0.75) return "secondary";
    return "outline";
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          <CardTitle>AI Vision Insights</CardTitle>
        </div>
        <CardDescription>Automatic detection powered by Google Vision</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="labels" className="space-y-4">
          <TabsList>
            <TabsTrigger value="labels">
              <Tag className="h-4 w-4 mr-2" />
              Labels ({labels.length})
            </TabsTrigger>
            {logos.length > 0 && (
              <TabsTrigger value="logos">
                <Award className="h-4 w-4 mr-2" />
                Logos ({logos.length})
              </TabsTrigger>
            )}
            {(webDetection.entities.length > 0 || webDetection.similar_images.length > 0) && (
              <TabsTrigger value="web">
                <Globe className="h-4 w-4 mr-2" />
                Web Detection
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="labels" className="space-y-4">
            {sportLabels.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Sports</h4>
                <div className="flex flex-wrap gap-2">
                  {sportLabels.map((label, idx) => (
                    <Badge key={idx} variant={getConfidenceColor(label.score)}>
                      {label.description}
                      <span className="ml-1 text-xs opacity-70">
                        {Math.round(label.score * 100)}%
                      </span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {gameLabels.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Card Game</h4>
                <div className="flex flex-wrap gap-2">
                  {gameLabels.map((label, idx) => (
                    <Badge key={idx} variant={getConfidenceColor(label.score)}>
                      {label.description}
                      <span className="ml-1 text-xs opacity-70">
                        {Math.round(label.score * 100)}%
                      </span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {conditionLabels.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Condition & Style</h4>
                <div className="flex flex-wrap gap-2">
                  {conditionLabels.map((label, idx) => (
                    <Badge key={idx} variant={getConfidenceColor(label.score)}>
                      {label.description}
                      <span className="ml-1 text-xs opacity-70">
                        {Math.round(label.score * 100)}%
                      </span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {otherLabels.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Other Attributes</h4>
                <div className="flex flex-wrap gap-2">
                  {otherLabels.slice(0, 10).map((label, idx) => (
                    <Badge key={idx} variant={getConfidenceColor(label.score)}>
                      {label.description}
                      <span className="ml-1 text-xs opacity-70">
                        {Math.round(label.score * 100)}%
                      </span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {labels.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No labels detected
              </p>
            )}
          </TabsContent>

          {logos.length > 0 && (
            <TabsContent value="logos" className="space-y-2">
              <div className="space-y-2">
                {logos.map((logo, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Award className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">{logo.description}</p>
                        <p className="text-sm text-muted-foreground">
                          Confidence: {Math.round(logo.score * 100)}%
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          )}

          {(webDetection.entities.length > 0 || webDetection.similar_images.length > 0) && (
            <TabsContent value="web" className="space-y-4">
              {webDetection.entities.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Related Entities</h4>
                  <div className="space-y-2">
                    {webDetection.entities.slice(0, 10).map((entity, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 border rounded">
                        <div>
                          <p className="font-medium text-sm">{entity.description}</p>
                          {entity.entityId && (
                            <p className="text-xs text-muted-foreground">ID: {entity.entityId}</p>
                          )}
                        </div>
                        <Badge variant="secondary">
                          {Math.round(entity.score * 100)}%
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {webDetection.matching_images.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Exact Matches Online</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {webDetection.matching_images.map((url, idx) => (
                      <a
                        key={idx}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="relative group"
                      >
                        <img
                          src={url}
                          alt={`Match ${idx + 1}`}
                          className="w-full h-32 object-cover rounded border"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded">
                          <ExternalLink className="h-5 w-5 text-white" />
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {webDetection.similar_images.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Similar Images</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {webDetection.similar_images.map((url, idx) => (
                      <a
                        key={idx}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="relative group"
                      >
                        <img
                          src={url}
                          alt={`Similar ${idx + 1}`}
                          className="w-full h-32 object-cover rounded border"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded">
                          <ExternalLink className="h-5 w-5 text-white" />
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {webDetection.entities.length === 0 && 
               webDetection.similar_images.length === 0 && 
               webDetection.matching_images.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No web detection results available
                </p>
              )}
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}