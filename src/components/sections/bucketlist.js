import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useStaticQuery, graphql } from 'gatsby';
import styled from 'styled-components';
import { srConfig } from '@config';
import sr from '@utils/sr';
import { Icon } from '@components/icons';
import { usePrefersReducedMotion } from '@hooks';

// ---------------------------------------------------------------------------
// Media helper: figure out what kind of proof a bucket-list item has attached.
//   YouTube (watch / shorts / youtu.be) -> iframe embed + auto thumbnail
//   Instagram (reel / post)             -> iframe embed
//   .mp4 / .webm / .mov                 -> native <video>
//   .jpg / .png / .webp / .gif          -> <img>
//   anything else                       -> plain external link
// ---------------------------------------------------------------------------
const getMedia = url => {
  if (!url) {
    return null;
  }

  const yt = url.match(/(?:youtube\.com\/(?:shorts\/|watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) {
    return {
      type: 'youtube',
      url,
      embed: `https://www.youtube.com/embed/${yt[1]}?autoplay=1&rel=0`,
      thumb: `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`,
      portrait: /shorts\//.test(url),
    };
  }

  const ig = url.match(/instagram\.com\/(reels?|p|tv)\/([\w-]+)/);
  if (ig) {
    const kind = ig[1] === 'reels' ? 'reel' : ig[1];
    return {
      type: 'instagram',
      url,
      embed: `https://www.instagram.com/${kind}/${ig[2]}/embed`,
      portrait: true,
    };
  }

  if (/\.(mp4|webm|mov)(\?.*)?$/i.test(url)) {
    return { type: 'video', url };
  }

  if (/\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i.test(url)) {
    return { type: 'image', url, thumb: url };
  }

  return { type: 'link', url };
};

const STATUS = {
  todo: { label: 'LOCKED' },
  doing: { label: 'IN PROGRESS' },
  done: { label: 'UNLOCKED' },
};

const StyledBucketSection = styled.section`
  display: flex;
  flex-direction: column;
  align-items: flex-start;

  .subtitle {
    margin: -20px 0 0;
    color: var(--slate);
    font-family: var(--font-mono);
    font-size: var(--fz-sm);
  }

  .progress {
    display: flex;
    align-items: center;
    width: 100%;
    margin: 25px 0 0;
    gap: 15px;
    font-family: var(--font-mono);
    font-size: var(--fz-xs);
    color: var(--green);

    .bar {
      flex: 1;
      max-width: 320px;
      height: 6px;
      border-radius: 99px;
      background-color: var(--lightest-navy);
      overflow: hidden;
    }

    .fill {
      height: 100%;
      border-radius: 99px;
      background: linear-gradient(90deg, var(--green), var(--pink));
      transition: width 0.6s var(--easing);
    }
  }

  .bucket-grid {
    ${({ theme }) => theme.mixins.resetList};
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    grid-gap: 20px;
    position: relative;
    width: 100%;
    margin-top: 50px;

    @media (max-width: 1080px) {
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    }
  }
`;

const StyledCard = styled.li`
  position: relative;
  cursor: default;
  transition: var(--transition);

  @media (prefers-reduced-motion: no-preference) {
    &:nth-child(odd):hover .card,
    &:nth-child(odd):focus-within .card {
      transform: translateY(-7px) rotate(-0.8deg);
    }
    &:nth-child(even):hover .card,
    &:nth-child(even):focus-within .card {
      transform: translateY(-7px) rotate(0.8deg);
    }
  }

  .card {
    ${({ theme }) => theme.mixins.boxShadow};
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 1px solid var(--lightest-navy);
    border-radius: var(--border-radius);
    background-color: var(--light-navy);
    overflow: hidden;
    transition: var(--transition);
  }

  &:hover .card,
  &:focus-within .card {
    border-color: var(--green);
  }

  .media {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 16 / 10;
    padding: 0;
    border: 0;
    border-bottom: 1px solid var(--lightest-navy);
    background: radial-gradient(circle at 30% 20%, var(--lightest-navy), var(--dark-navy) 70%);
    color: inherit;
    overflow: hidden;
    cursor: default;

    img,
    video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: var(--transition);
    }
  }

  button.media,
  a.media {
    cursor: pointer;

    &:hover img,
    &:focus-visible img,
    &:hover video,
    &:focus-visible video {
      transform: scale(1.05);
    }
  }

  &.todo .media img,
  &.todo .media video {
    filter: grayscale(1) brightness(0.8);
  }
  &.todo:hover .media img,
  &.todo:hover .media video {
    filter: none;
  }

  .placeholder {
    ${({ theme }) => theme.mixins.flexCenter};
    flex-direction: column;
    width: 100%;
    height: 100%;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fz-xxs);
    color: var(--slate);

    .big-emoji {
      font-size: 48px;
      line-height: 1;
    }

    &.insta {
      background: linear-gradient(135deg, #833ab4, #fd1d1d 55%, #fcb045);
      color: #fff;
      svg {
        width: 42px;
        height: 42px;
      }
    }
  }

  .play {
    ${({ theme }) => theme.mixins.flexCenter};
    position: absolute;
    right: 12px;
    bottom: 12px;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background-color: rgba(0, 0, 0, 0.7);
    border: 1px solid var(--green);
    color: var(--green);
    font-size: 14px;
    padding-left: 3px;
    backdrop-filter: blur(4px);
  }

  .badge {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 1;
    padding: 5px 9px;
    border-radius: 99px;
    background-color: rgba(0, 0, 0, 0.75);
    border: 1px solid currentColor;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    line-height: 1;
    color: var(--slate);

    &.doing {
      color: var(--pink);
    }
    &.done {
      color: var(--green);
    }
  }

  .body {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    padding: 1.5rem 1.5rem 1.4rem;
  }

  .title {
    margin: 0 0 10px;
    color: var(--lightest-slate);
    font-size: var(--fz-xxl);
  }

  .description {
    flex-grow: 1;
    color: var(--light-slate);
    font-size: 16px;

    p {
      margin: 0;
    }

    a {
      ${({ theme }) => theme.mixins.inlineLink};
    }
  }

  .vibe {
    margin: 18px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fz-xxs);
    color: var(--green);
  }

  &.done .title {
    text-decoration: line-through;
    text-decoration-color: var(--green);
    text-decoration-thickness: 2px;
  }
`;

const StyledLightbox = styled.div`
  ${({ theme }) => theme.mixins.flexCenter};
  position: fixed;
  inset: 0;
  z-index: 100;
  padding: 20px;
  background-color: rgba(0, 0, 0, 0.88);
  backdrop-filter: blur(6px);

  .frame {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 100%;
  }

  .close {
    align-self: flex-end;
    margin-bottom: 10px;
    padding: 6px 12px;
    border: 1px solid var(--green);
    border-radius: var(--border-radius);
    background: transparent;
    color: var(--green);
    font-family: var(--font-mono);
    font-size: var(--fz-xs);
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background-color: var(--green-tint);
      outline: none;
    }
  }

  iframe {
    border: 0;
    border-radius: var(--border-radius);
    background-color: #000;

    &.wide {
      width: min(92vw, 960px);
      aspect-ratio: 16 / 9;
    }
    &.portrait {
      width: min(92vw, 400px);
      height: min(78vh, 720px);
    }
  }

  video,
  img {
    max-width: 92vw;
    max-height: 78vh;
    border-radius: var(--border-radius);
    background-color: #000;
  }

  .caption {
    margin: 14px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fz-sm);
    color: var(--light-slate);
  }
`;

const Lightbox = ({ item, onClose }) => {
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const { media, title } = item;
  let content = null;

  if (media.type === 'youtube' || media.type === 'instagram') {
    content = (
      <iframe
        className={media.portrait ? 'portrait' : 'wide'}
        src={media.embed}
        title={title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    );
  } else if (media.type === 'video') {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    content = <video src={media.url} controls autoPlay playsInline loop />;
  } else if (media.type === 'image') {
    content = <img src={media.url} alt={title} />;
  }

  return createPortal(
    <StyledLightbox role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="frame" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close" autoFocus>
          close [esc]
        </button>
        {content}
        <p className="caption">{title}</p>
      </div>
    </StyledLightbox>,
    document.body,
  );
};

const BucketList = () => {
  const data = useStaticQuery(graphql`
    query {
      items: allMarkdownRemark(
        filter: { fileAbsolutePath: { regex: "/content/bucketlist/" } }
        sort: { fields: [frontmatter___order], order: ASC }
      ) {
        edges {
          node {
            frontmatter {
              title
              order
              status
              emoji
              vibe
              media
              thumb
            }
            html
          }
        }
      }
    }
  `);

  const [active, setActive] = useState(null);
  const close = useCallback(() => setActive(null), []);

  const revealTitle = useRef(null);
  const revealMeta = useRef(null);
  const revealCards = useRef([]);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }

    sr.reveal(revealTitle.current, srConfig());
    sr.reveal(revealMeta.current, srConfig(100));
    revealCards.current.forEach((ref, i) => ref && sr.reveal(ref, srConfig(i * 100)));
  }, []);

  const items = data.items.edges.filter(({ node }) => node);
  const total = items.length;
  const done = items.filter(({ node }) => node.frontmatter.status === 'done').length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const renderMedia = (f, status) => {
    const media = getMedia(f.media);
    const cover = f.thumb || (media && media.thumb) || null;
    const hasPlay = media && ['youtube', 'instagram', 'video'].includes(media.type);

    let inner;
    if (cover) {
      inner = <img src={cover} alt="" loading="lazy" />;
    } else if (media && media.type === 'video') {
      // eslint-disable-next-line jsx-a11y/media-has-caption
      inner = <video src={`${media.url}#t=0.5`} preload="metadata" muted playsInline />;
    } else if (media && media.type === 'instagram') {
      inner = (
        <div className="placeholder insta">
          <Icon name="Instagram" />
          <span>watch the reel</span>
        </div>
      );
    } else {
      inner = (
        <div className="placeholder">
          <span className="big-emoji">{f.emoji}</span>
          <span>{status === 'done' ? 'proof coming soon' : 'proof loading…'}</span>
        </div>
      );
    }

    const badge = <span className={`badge ${status}`}>{STATUS[status].label}</span>;
    const play = hasPlay ? (
      <span className="play" aria-hidden="true">
        ▶
      </span>
    ) : null;

    if (media && media.type === 'link') {
      return (
        <a className="media" href={media.url} target="_blank" rel="noreferrer">
          {badge}
          {inner}
        </a>
      );
    }

    if (media) {
      return (
        <button
          className="media"
          aria-label={`Open proof for ${f.title}`}
          onClick={() => setActive({ title: f.title, media })}>
          {badge}
          {inner}
          {play}
        </button>
      );
    }

    return (
      <div className="media">
        {badge}
        {inner}
      </div>
    );
  };

  return (
    <StyledBucketSection id="bucketlist">
      <h2 className="numbered-heading" ref={revealTitle}>
        The Bucket List
      </h2>

      <div ref={revealMeta} style={{ width: '100%' }}>
        <p className="subtitle">Side quests that have nothing to do with code. Unlocking one at a time.</p>
        <div className="progress">
          <span className="count">
            {done}/{total} unlocked
          </span>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <ul className="bucket-grid">
        {items.map(({ node }, i) => {
          const { frontmatter: f, html } = node;
          const status = STATUS[f.status] ? f.status : 'todo';

          return (
            <StyledCard key={i} className={status} ref={el => (revealCards.current[i] = el)}>
              <div className="card">
                {renderMedia(f, status)}
                <div className="body">
                  <h3 className="title">
                    {f.emoji && <span aria-hidden="true">{f.emoji} </span>}
                    {f.title}
                  </h3>
                  <div className="description" dangerouslySetInnerHTML={{ __html: html }} />
                  {f.vibe && <p className="vibe">{f.vibe}</p>}
                </div>
              </div>
            </StyledCard>
          );
        })}
      </ul>

      {active && <Lightbox item={active} onClose={close} />}
    </StyledBucketSection>
  );
};

export default BucketList;
