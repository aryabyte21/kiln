package bridge

import "testing"

func TestSubjectForTopology(t *testing.T) {
	subject := SubjectForTopology("my-swarm", "route.resolve")
	want := "swarm.my-swarm.pipeline.route.resolve"
	if subject != want {
		t.Errorf("subject = %q, want %q", subject, want)
	}
}

func TestSubjectForTopology_DottedSubject(t *testing.T) {
	subject := SubjectForTopology("news-pipeline", "articles.raw")
	want := "swarm.news-pipeline.pipeline.articles.raw"
	if subject != want {
		t.Errorf("subject = %q, want %q", subject, want)
	}
}
