import { getDailyScienceArticle, getArticleSummary, ScienceArticle } from '../scienceArticles';

describe('Science Articles - Daily Selection, Progression & Summary', () => {
  const mockArticles: ScienceArticle[] = [
    { slug: 'article-1', title: 'Article One', blocks: [], furtherStudyTopics: [] },
    { slug: 'article-2', title: 'Article Two', blocks: [], furtherStudyTopics: [] },
    { slug: 'article-3', title: 'Article Three', blocks: [], furtherStudyTopics: [] },
  ];

  it('returns null when articles list is empty', () => {
    expect(getDailyScienceArticle([], Date.now())).toBeNull();
  });

  it('remains stable throughout the same calendar day', () => {
    // 2026-10-16T08:00:00Z
    const morningTime = new Date('2026-10-16T08:00:00Z').getTime();
    // 2026-10-16T22:30:00Z (same day)
    const eveningTime = new Date('2026-10-16T22:30:00Z').getTime();

    const morningArticle = getDailyScienceArticle(mockArticles, morningTime);
    const eveningArticle = getDailyScienceArticle(mockArticles, eveningTime);

    expect(morningArticle).toEqual(eveningArticle);
  });

  it('progresses sequentially across days and wraps around correctly', () => {
    const baseTime = new Date('2026-10-16T12:00:00Z').getTime();
    const dayMs = 24 * 60 * 60 * 1000;

    const day1 = getDailyScienceArticle(mockArticles, baseTime);
    const day2 = getDailyScienceArticle(mockArticles, baseTime + dayMs);
    const day3 = getDailyScienceArticle(mockArticles, baseTime + 2 * dayMs);
    const day4 = getDailyScienceArticle(mockArticles, baseTime + 3 * dayMs); // Should wrap to article 1

    expect(day1?.slug).toEqual('article-1');
    expect(day2?.slug).toEqual('article-2');
    expect(day3?.slug).toEqual('article-3');
    expect(day4?.slug).toEqual('article-1');
  });

  it('strips inline markdown formatting (** and *) supported by the renderer from article summary', () => {
    const articleWithMarkdown: ScienceArticle = {
      slug: 'md-article',
      title: 'MD Article',
      blocks: [
        { type: 'paragraph', text: 'This has **bold** and *italics* formatting.' }
      ],
      furtherStudyTopics: [],
    };
    expect(getArticleSummary(articleWithMarkdown)).toEqual('This has bold and italics formatting.');
  });
});
